import { describe, test, expect } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { signup, POST, GET } from "./httpHelpers.js";
import { aiAttachmentService } from "../src/services/aiAttachmentService.js";
import { aiSessionService } from "../src/services/aiSessionService.js";
import { buildAgentMessages } from "../src/services/agent/messages.js";
import { extractPdfText } from "../src/lib/pdfText.js";
import { config } from "../src/config.js";
import { db } from "../src/db/index.js";
import { executeTool } from "../src/services/agent/registry.js";
import "../src/services/agentService.js";

// Files the visitor sends the assistant.
//
// Three things are worth testing here and the rest is plumbing: that the
// bytes are what they claim to be (they go to a third party), that one
// customer cannot read another's invoice, and that attaching a 1.5MB image
// does not move the cached prefix of the prompt.

/* --- fixtures ----------------------------------------------------------- */

// The smallest real PNG: 1x1, transparent.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const PNG_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
const JPEG_URL = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString("base64")}`;

/** A PDF with a Flate-compressed content stream, like a generated proforma. */
function makePdf(lines) {
  const content = `BT /F1 12 Tf 72 720 Td ${lines.map((l) => `(${l}) Tj T* `).join("")}ET`;
  const stream = Buffer.from(Bun.deflateSync(Buffer.from(content, "latin1")));
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
    null, // the stream object, assembled below
  ];
  let pdf = Buffer.from("%PDF-1.4\n", "latin1");
  const chunks = [pdf];
  objs.forEach((body, i) => {
    const n = i + 1;
    if (body === null) {
      chunks.push(
        Buffer.from(`${n} 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
        stream,
        Buffer.from("\nendstream\nendobj\n", "latin1")
      );
    } else {
      chunks.push(Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, "latin1"));
    }
  });
  chunks.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF", "latin1"));
  return Buffer.concat(chunks);
}

const pdfUrl = (lines) => `data:application/pdf;base64,${makePdf(lines).toString("base64")}`;

// `ai_attachments.user_id` is a real foreign key, so the owner has to be a
// real account even for the tests that never go near HTTP.
const owner = await signup("att-owner");
const OWNER = owner.user.id;

/* --- what the bytes actually are ---------------------------------------- */

describe("the declared type is not believed", () => {
  test("HTML wearing a .png content type is refused", async () => {
    // The real vector: these bytes are forwarded to a third-party model, and
    // an upload endpoint that stores whatever it is handed under whatever
    // name it is given is how that becomes someone else's problem.
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    await expect(
      aiAttachmentService.upload({
        userId: OWNER,
        dataUrl: `data:image/png;base64,${html.toString("base64")}`,
        filename: "cat.png",
      })
    ).rejects.toMatchObject({ code: "attachment_mismatch" });
  });

  test("a PDF renamed to .jpg is refused", async () => {
    await expect(
      aiAttachmentService.upload({
        userId: OWNER,
        dataUrl: `data:image/jpeg;base64,${makePdf(["hello"]).toString("base64")}`,
        filename: "scan.jpg",
      })
    ).rejects.toMatchObject({ code: "attachment_mismatch" });
  });

  test("each accepted format is recognised by its own signature", async () => {
    for (const [url, mime] of [
      [PNG_URL, "image/png"],
      [JPEG_URL, "image/jpeg"],
      [pdfUrl(["x"]), "application/pdf"],
    ]) {
      const row = await aiAttachmentService.upload({ userId: OWNER, dataUrl: url, filename: "f" });
      expect(`${mime} accepted`).toBe(`${row.mime} accepted`);
    }
  });

  test("an executable format is refused before anything is written", async () => {
    await expect(
      aiAttachmentService.upload({
        userId: OWNER,
        dataUrl: "data:text/html;base64,PGh0bWw+",
        filename: "x.html",
      })
    ).rejects.toMatchObject({ code: "attachment_type" });
  });

  test("something too large is refused by decoded size, not by string length", async () => {
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(config.aiMaxAttachmentBytes)]);
    await expect(
      aiAttachmentService.upload({
        userId: OWNER,
        dataUrl: `data:image/png;base64,${big.toString("base64")}`,
        filename: "big.png",
      })
    ).rejects.toMatchObject({ code: "attachment_too_large" });
  });
});

describe("the filename is ours", () => {
  test("a traversing filename cannot escape the upload directory", async () => {
    const row = await aiAttachmentService.upload({
      userId: OWNER,
      dataUrl: PNG_URL,
      filename: "../../../../etc/passwd.png",
    });
    const stored = db.aiAttachments.get(row.id);

    // The client's name survives as a label and nowhere else.
    expect(stored.original_name).toBe("../../../../etc/passwd.png");
    expect(stored.storage_path.startsWith(path.resolve(config.uploadDir, "ai") + path.sep)).toBe(true);
    expect(stored.filename).not.toContain("/");
    expect(stored.filename).not.toContain("..");
    expect(await readFile(stored.storage_path)).toEqual(PNG_BYTES);
  });
});

/* --- isolation ---------------------------------------------------------- */

describe("one visitor cannot read another's file", () => {
  test("a stranger's attachment id is a 404, not a 403", async () => {
    // 403 would confirm the id exists, which is the only thing an attacker
    // holding a guessed id actually learns.
    const alice = await signup("att-a");
    const bob = await signup("att-b");

    const up = await POST("/ai/attachments", { data_url: PNG_URL, filename: "invoice.png" }, { token: alice.token });
    expect(up.status).toBe(201);

    expect((await GET(`/ai/attachments/${up.body.id}`, { token: alice.token })).status).toBe(200);
    expect((await GET(`/ai/attachments/${up.body.id}`, { token: bob.token })).status).toBe(404);
    expect((await GET(`/ai/attachments/${up.body.id}`)).status).toBe(401);
  });

  test("view_attachment refuses an id belonging to someone else", async () => {
    const alice = await signup("att-view-a");
    const bob = await signup("att-view-b");
    const row = await aiAttachmentService.upload({
      userId: alice.user.id,
      dataUrl: pdfUrl(["TOTAL EUR 38,000.00"]),
      filename: "proforma.pdf",
    });

    const mine = await executeTool(
      { id: "c1", name: "view_attachment", args: { attachment_id: row.id }, valid: true },
      { userId: alice.user.id, permissions: [], emit: () => {} }
    );
    expect(mine.result.text).toContain("38,000.00");

    const theirs = await executeTool(
      { id: "c2", name: "view_attachment", args: { attachment_id: row.id }, valid: true },
      { userId: bob.user.id, permissions: [], emit: () => {} }
    );
    expect(JSON.stringify(theirs)).not.toContain("38,000.00");
    expect(theirs.result.error).toBeTruthy();
  });

  test("the file is served with headers that stop it executing on our origin", async () => {
    const alice = await signup("att-headers");
    const up = await POST("/ai/attachments", { data_url: PNG_URL }, { token: alice.token });
    const res = await GET(`/ai/attachments/${up.body.id}`, { token: alice.token });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });
});

/* --- what reaches the model --------------------------------------------- */

describe("the prompt the model sees", () => {
  const base = { message: "what is the total?", context: "CONTEXT", toolNames: ["search_catalogue"] };

  test("an image lands in the LAST user message and nowhere else", async () => {
    const parts = [{ type: "image_url", image_url: { url: PNG_URL } }];
    const messages = buildAgentMessages({
      ...base,
      history: [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
      ],
      attachmentParts: parts,
    });

    const users = messages.filter((m) => m.role === "user");
    expect(users.length).toBe(2);
    expect(typeof users[0].content).toBe("string");
    expect(Array.isArray(users[1].content)).toBe(true);
    expect(users[1].content[0].type).toBe("text");
    expect(users[1].content[1].image_url.url).toBe(PNG_URL);
  });

  test("attaching a file does not move ONE byte of the cached prefix", async () => {
    // The prefix -- digest, rules, agent rules, history -- is what the
    // provider's prompt cache keys on. Splicing an image into an earlier
    // message rewrites it on every request and the cache silently never hits
    // again; nothing breaks, the bill just quietly triples.
    const without = buildAgentMessages({ ...base, history: [{ role: "user", content: "hi" }] });
    const with_ = buildAgentMessages({
      ...base,
      history: [{ role: "user", content: "hi" }],
      attachmentParts: [{ type: "image_url", image_url: { url: PNG_URL } }],
    });

    const prefix = (m) => JSON.stringify(m.slice(0, -1));
    expect(prefix(with_)).toBe(prefix(without));
    // …and the question itself is still there, word for word.
    expect(with_.at(-1).content[0].text).toBe(without.at(-1).content);
  });

  test("a document arrives as its text, not as a picture of itself", async () => {
    const row = await aiAttachmentService.upload({
      userId: OWNER,
      dataUrl: pdfUrl(["PROFORMA INVOICE", "No. PRO-ABC123"]),
      filename: "proforma.pdf",
    });
    const parts = await aiAttachmentService.buildParts([db.aiAttachments.get(row.id)]);

    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toContain("proforma.pdf");
    expect(parts[0].text).toContain("PRO-ABC123");
  });

  test("a document with no extractable text says so instead of arriving empty", async () => {
    // A scan is a photograph of a document: there is no text to find. The
    // model has to be told that, or it answers from the filename.
    const row = await aiAttachmentService.upload({
      userId: OWNER,
      dataUrl: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\nno streams here\n%%EOF").toString("base64")}`,
      filename: "scan.pdf",
    });
    const [part] = await aiAttachmentService.buildParts([db.aiAttachments.get(row.id)]);
    expect(part.text).toContain("no extractable text");
    expect(part.text).toContain("send it as an image");
  });
});

/* --- across turns ------------------------------------------------------- */

describe("across turns", () => {
  test("a recent image is re-sent; an older one degrades to a mention with its id", async () => {
    const user = await signup("att-history");
    const session = aiSessionService.resolve({ userId: user.user.id, message: "first" });

    const old = await aiAttachmentService.upload({ userId: user.user.id, dataUrl: PNG_URL, filename: "old.png" });
    const recent = await aiAttachmentService.upload({ userId: user.user.id, dataUrl: PNG_URL, filename: "recent.png" });
    const mention = (a) => ({ id: a.id, kind: "image", mime: "image/png", filename: a.filename });

    await aiSessionService.appendTurn(session, { message: "look at this", reply: "ok", attachments: [mention(old)] });
    await aiSessionService.appendTurn(session, { message: "and this", reply: "ok", attachments: [mention(recent)] });
    await aiSessionService.appendTurn(session, { message: "and now?", reply: "ok" });

    const history = await aiSessionService.loadHistory(session);
    const [withOld, withRecent] = history.filter((m) => m.role === "user");

    // The old one is a sentence naming the file; the recent one is still the
    // picture itself.
    expect(typeof withOld.content).toBe("string");
    expect(withOld.content).toContain("old.png");
    expect(withOld.content).toContain(old.id);
    expect(withOld.content).toContain("view_attachment");

    expect(Array.isArray(withRecent.content)).toBe(true);
    expect(withRecent.content[0].text).toContain("and this");
    expect(withRecent.content.some((p) => p.type === "image_url")).toBe(true);
  });

  test("view_attachment puts an old image back in front of the model", async () => {
    // A tool result is text by definition, so the image cannot come back as
    // one. It re-enters as a user message, which is what `reviveAttachment`
    // exists to queue.
    const user = await signup("att-revive");
    const row = await aiAttachmentService.upload({ userId: user.user.id, dataUrl: PNG_URL, filename: "old.png" });

    const revived = [];
    const res = await executeTool(
      { id: "c1", name: "view_attachment", args: { attachment_id: row.id }, valid: true },
      {
        userId: user.user.id,
        permissions: [],
        emit: () => {},
        reviveAttachment: async (r) => revived.push(...(await aiAttachmentService.buildParts([r]))),
      }
    );

    expect(res.result.status).toBe("in_view");
    expect(revived.length).toBe(1);
    expect(revived[0].type).toBe("image_url");
  });

  test("list_attachments only ever lists this conversation's files", async () => {
    const alice = await signup("att-list-a");
    const bob = await signup("att-list-b");
    const hers = aiSessionService.resolve({ userId: alice.user.id, message: "x" });

    const a = await aiAttachmentService.upload({ userId: alice.user.id, dataUrl: PNG_URL, filename: "hers.png" });
    const b = await aiAttachmentService.upload({ userId: bob.user.id, dataUrl: PNG_URL, filename: "his.png" });
    aiAttachmentService.attachToSession([a.id], hers.id, alice.user.id);
    // Bob's file, pointed at Alice's conversation: refused by ownership, not
    // by the session id, which is the check that actually matters.
    aiAttachmentService.attachToSession([b.id], hers.id, alice.user.id);

    const res = await executeTool(
      { id: "c1", name: "list_attachments", args: {}, valid: true },
      { userId: alice.user.id, sessionId: hers.id, permissions: [], emit: () => {} }
    );
    const names = res.result.attachments.map((x) => x.filename);
    expect(names).toEqual(["hers.png"]);
  });
});

/* --- the extractor ------------------------------------------------------ */

describe("PDF text extraction", () => {
  test("reads a Flate-compressed generated invoice", () => {
    const text = extractPdfText(makePdf(["PROFORMA INVOICE", "No. PRO-ABC123", "TOTAL EUR 38,000.00"]));
    expect(text).toContain("PROFORMA INVOICE");
    expect(text).toContain("PRO-ABC123");
    expect(text).toContain("38,000.00");
  });

  test("garbage in returns empty rather than throwing", () => {
    // It runs inside an upload request. A malformed PDF must cost the visitor
    // a useful message, not a 500.
    expect(extractPdfText(Buffer.from("not a pdf at all"))).toBe("");
    expect(extractPdfText(Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00]))).toBe("");
  });
});

/* --- the route ---------------------------------------------------------- */

describe("the upload endpoint", () => {
  test("anonymous visitors are refused, and told to sign in rather than shown a limit", async () => {
    const res = await POST("/ai/attachments", { data_url: PNG_URL });
    expect(res.status).toBe(401);
  });

  test("a successful upload reports back what the composer needs to render it", async () => {
    const user = await signup("att-shape");
    const res = await POST(
      "/ai/attachments",
      { data_url: pdfUrl(["TOTAL EUR 1,000"]), filename: "quote.pdf" },
      { token: user.token }
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "document", mime: "application/pdf", filename: "quote.pdf", has_text: true });
    expect(res.body.preview_url).toBe(`/ai/attachments/${res.body.id}`);
    // Never the path on our disk.
    expect(JSON.stringify(res.body)).not.toContain(config.uploadDir);
  });

  test("a message can be nothing but a file", async () => {
    // "what's the total?" is often sent as the photograph alone.
    const user = await signup("att-empty");
    const up = await POST("/ai/attachments", { data_url: PNG_URL }, { token: user.token });
    const res = await POST(
      "/ai/chat",
      { message: "", attachment_ids: [up.body.id] },
      { token: user.token }
    );
    // 200 means it reached the assistant; without a key the stream itself
    // reports the failure, which is not what this asserts.
    expect(res.status).not.toBe(400);
  });

  test("an empty message with no file is still refused", async () => {
    const user = await signup("att-empty-2");
    const res = await POST("/ai/chat", { message: "   " }, { token: user.token });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("message_required");
  });
});

/* --- end to end --------------------------------------------------------- */

describe("a photograph, all the way to the model", () => {
  test("the image reaches the upstream request and the answer streams back", async () => {
    // The whole path with the model replaced by a script: upload over HTTP,
    // send a message referencing it, and read what the transport was handed.
    // Nothing here needs a live key, which is the point of `transport` being
    // a parameter rather than an import.
    const { agentService, buildToolContext } = await import("../src/services/agentService.js");
    const user = await signup("att-e2e");

    const up = await POST(
      "/ai/attachments",
      { data_url: PNG_URL, filename: "proforma-photo.png" },
      { token: user.token }
    );
    expect(up.status).toBe(201);

    const seen = [];
    const enc = new TextEncoder();
    const transport = async (req) => {
      seen.push(req);
      return {
        body: new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "The total is EUR 38,000." } }] })}\n\n`));
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
      };
    };

    const key = config.deepseekApiKey;
    config.deepseekApiKey = "sk-test-not-real";
    let sse = "";
    try {
      const ctx = {
        ...buildToolContext({ get: (k) => (k === "userId" ? user.user.id : null), req: { header: () => null } }),
        userId: user.user.id,
      };
      const stream = await agentService.stream({
        message: "what is the total on this?",
        attachmentIds: [up.body.id],
        ctx,
        transport,
      });
      for await (const chunk of stream) sse += new TextDecoder().decode(chunk);
    } finally {
      config.deepseekApiKey = key;
    }

    // What the model was actually sent.
    const lastUser = [...seen[0].messages].reverse().find((m) => m.role === "user");
    expect(Array.isArray(lastUser.content)).toBe(true);
    expect(lastUser.content[0].text).toContain("what is the total on this?");
    const image = lastUser.content.find((p) => p.type === "image_url");
    expect(image.image_url.url.startsWith("data:image/png;base64,")).toBe(true);

    // And what the visitor saw.
    expect(sse).toContain("The total is EUR 38,000.");
    expect(sse).toContain("event: done");

    // The file is now part of the conversation, so a later turn can reopen it.
    const sessionId = JSON.parse(/event: session\ndata: (.+)/.exec(sse)[1]).id;
    expect(db.aiAttachments.listForSession(sessionId, user.user.id).map((r) => r.original_name)).toEqual([
      "proforma-photo.png",
    ]);
  });
});

describe("the session id on an upload", () => {
  test("a conversation id the server has never seen does not fail the upload", async () => {
    // The composer sends whatever it is attached to, and that can be a
    // browser-generated id from before the visitor signed in. Refusing the
    // file over it would lose an upload for a reason the visitor cannot see
    // or fix. Found by attaching a second file after a stubbed session event.
    const user = await signup("att-badsession");
    const res = await POST(
      "/ai/attachments",
      { data_url: PNG_URL, filename: "x.png", session_id: "s_from_the_browser" },
      { token: user.token }
    );
    expect(res.status).toBe(201);
    expect(db.aiAttachments.get(res.body.id).session_id).toBe(null);
  });

  test("a file cannot be filed into someone else's conversation", async () => {
    const alice = await signup("att-session-a");
    const bob = await signup("att-session-b");
    const hers = aiSessionService.resolve({ userId: alice.user.id, message: "mine" });

    const res = await POST(
      "/ai/attachments",
      { data_url: PNG_URL, session_id: hers.id },
      { token: bob.token }
    );
    expect(res.status).toBe(201);
    expect(db.aiAttachments.get(res.body.id).session_id).toBe(null);
  });
});

describe("deleting a conversation", () => {
  test("takes the files in it off the disk, not just out of the table", async () => {
    // The rows cascade on their own; the bytes do not. A visitor deleting a
    // conversation means the invoice they put in it as well -- leaving it on
    // disk is both a storage leak and a promise quietly broken.
    const user = await signup("att-delete");
    const session = aiSessionService.resolve({ userId: user.user.id, message: "delete me" });
    const row = await aiAttachmentService.upload({
      userId: user.user.id,
      sessionId: session.id,
      dataUrl: PNG_URL,
      filename: "invoice.png",
    });
    const onDisk = db.aiAttachments.get(row.id).storage_path;
    expect(await readFile(onDisk)).toEqual(PNG_BYTES);

    aiSessionService.remove(session.id, user.user.id);
    // The unlink is deliberately not awaited by the caller, so give it a tick.
    await new Promise((r) => setTimeout(r, 50));

    expect(db.aiAttachments.get(row.id)).toBe(null);
    expect(await readFile(onDisk).then(() => "still there").catch(() => "gone")).toBe("gone");
  });
});

test("a row that cannot be inserted does not leave its bytes behind", async () => {
  // The file is written before the row exists, so a rejected insert -- an
  // account deleted mid-request, a constraint -- would otherwise orphan bytes
  // that nothing points at and nothing will ever clean up.
  const before = new Set(await readdir(path.resolve(config.uploadDir, "ai")).catch(() => []));
  await expect(
    aiAttachmentService.upload({ userId: "no-such-user", dataUrl: PNG_URL, filename: "x.png" })
  ).rejects.toBeTruthy();
  const after = await readdir(path.resolve(config.uploadDir, "ai")).catch(() => []);
  expect(after.filter((f) => !before.has(f))).toEqual([]);
});
