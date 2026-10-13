import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Eye,
  FileText,
  Globe,
  Link2,
  Lock,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Sparkle,
  Sparkles,
  Square,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { AiProductCard } from "./ProductCard.jsx";
import { streamChat, getSession, getQuota, uploadAttachment } from "../../lib/aiClient.js";
import { AttachmentTray, AttachmentChips } from "./AttachmentTray.jsx";
import { ACCEPT_ATTR, MAX_ATTACHMENTS, prepareAttachment } from "../../lib/attachments.js";
import { SessionList } from "./SessionList.jsx";
import { dispatchClientAction } from "../../lib/clientActions.js";
import { ConfirmCard } from "./ConfirmCard.jsx";
import { AgentTimeline } from "./AgentTimeline.jsx";
import { routeContextFor, routeLabel, routePrompts } from "../../lib/routeContext.js";
import { useT } from "../../i18n/I18nProvider.jsx";
import { useSiteConfig } from "../../context/SiteConfigContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { cn } from "../../lib/cn.js";
import { ORG_NAME } from "../../lib/orgInfo.js";
import { Button } from "@/components/shadcn/button.jsx";
import { Separator } from "@/components/shadcn/separator.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu.jsx";

// The assistant.
//
// Laid out as a full-width workspace: a titled header with its own actions,
// the documents an answer was grounded in listed above it, a status trace
// while it works, and a composer that carries the conversation's scope as a
// chip. That shape exists because this assistant is retrieval-backed -- the
// `sources` SSE event arrives BEFORE the first token, naming exactly what was
// retrieved, and until now the client threw it away. Showing it is the whole
// difference between "a chatbot said so" and "here is what it read".
//
// Deliberately still has no markdown renderer. The model is instructed to
// answer in short plain sentences; headings and bullets are recognised from
// the plain text it emits (see `renderAnswer`) rather than pulling in ~40KB
// to interpret syntax that mostly should not be there. Structure that
// genuinely matters -- which products it is pointing at -- arrives as
// validated data and is rendered as real <Link>s.
//
// A note on what is NOT here. The reference design carries a model picker, a
// Share button and a "Thought" trace. Both are real here: Share copies the
// transcript, and the trace (AgentTimeline) lists the steps the agent
// actually ran. The model pill prints the model this deployment really calls,
// read from /site-config -- naming a different one would be a claim the user
// has no way to check.

/* --- small pieces ------------------------------------------------------ */

function IconButton({ label, active = false, className, children, ...props }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className={cn(
        "h-8 w-8 shrink-0 cursor-pointer rounded-full text-ink-2 hover:bg-panel-2 hover:text-ink",
        active && "bg-brand-blue/10 text-brand-blue hover:bg-brand-blue/15 hover:text-brand-blue",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

/** Copy-to-clipboard that confirms in place rather than firing a toast. */
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={label}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4 text-brand-green" /> : <Copy className="h-4 w-4" />}
    </IconButton>
  );
}

/**
 * One retrieved source.
 *
 * The dotted underline is the point: it marks the title as a reference the
 * answer leaned on rather than a link the visitor is being sold. Products
 * carry a real route and are clickable; staff-written knowledge entries have
 * no public page, so they render as plain text rather than as a link that
 * would 404.
 */
function SourceRow({ item, onNavigate }) {
  const isWeb = item.kind === "web";
  const isProduct = !isWeb && item.kind !== "knowledge";
  const Icon = isWeb ? Globe : isProduct ? Sparkle : FileText;

  const body = (
    <>
      <span
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-[5px]",
          isWeb ? "bg-panel-2 text-ink-2" : isProduct ? "bg-brand-blue text-white" : "bg-panel-2 text-ink-2"
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className="min-w-0 truncate border-b border-dotted border-ink-3/60 pb-px text-[13.5px] font-semibold text-ink">
        {item.name}
      </span>
      {/* The domain, always. An answer that leans on an outside page has to
          say whose page it was -- that is the difference between a citation
          and an assertion. */}
      {isWeb && item.domain ? (
        <span className="shrink-0 text-[11.5px] text-ink-3">{item.domain}</span>
      ) : null}
    </>
  );

  if (isWeb && item.url) {
    return (
      <a
        href={item.url}
        target="_blank"
        // noreferrer as well as noopener: the target is a third-party page we
        // do not control, and it has no business learning where the visitor
        // came from.
        rel="noopener noreferrer"
        className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-panel-2"
      >
        {body}
      </a>
    );
  }

  if (isProduct && item.slug) {
    return (
      <Link
        to={`/devices/${item.slug}`}
        onClick={onNavigate}
        className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-panel-2"
      >
        {body}
      </Link>
    );
  }
  return <div className="flex min-w-0 items-center gap-2.5 px-1 py-1">{body}</div>;
}

/** The collapsible list of what an answer was grounded in. */
function Sources({ items, onNavigate, t }) {
  const [expanded, setExpanded] = useState(false);
  if (!items?.length) return null;
  const VISIBLE = 3;
  const shown = expanded ? items : items.slice(0, VISIBLE);
  const hidden = items.length - shown.length;

  return (
    <div className="grid min-w-0 gap-0.5">
      {shown.map((s) => (
        <SourceRow key={`${s.kind}:${s.slug}`} item={s} onNavigate={onNavigate} />
      ))}
      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-start hover:bg-panel-2"
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center text-ink-3">
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </span>
          <span className="text-[13.5px] font-semibold text-ink-2">
            {expanded ? t("ai.less") : `${t("ai.more")}${hidden ? ` (${hidden})` : ""}`}
          </span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * Plain text, given structure.
 *
 * The model is asked for short prose, but it does reliably produce two
 * things worth rendering as more than a paragraph: short headed sections and
 * middot bullets (parseReply on the server rewrites "- " into "· "). This
 * recognises exactly those two and leaves everything else alone -- which is
 * why there is no markdown dependency here.
 */
function Answer({ text }) {
  const blocks = useMemo(() => {
    const out = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = /^[·•]\s+/.test(line);
      const numbered = /^\d+[.)]\s+/.test(line);
      // A short line ending in no punctuation, followed by more text, reads
      // as a heading -- that is the only heuristic used, and it is
      // deliberately conservative.
      const heading = !bullet && !numbered && line.length < 60 && !/[.!?:،؛]$/.test(line);
      out.push({ kind: bullet ? "bullet" : numbered ? "numbered" : heading ? "heading" : "para", line });
    }
    return out;
  }, [text]);

  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.kind === "heading" ? (
          <h3 key={i} className="pt-1.5 text-[15.5px] font-black text-ink">
            {b.line}
          </h3>
        ) : b.kind === "bullet" || b.kind === "numbered" ? (
          <div key={i} className="flex gap-2.5 ps-1">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
            <p className="text-[14px] leading-relaxed text-ink">{b.line.replace(/^([·•]|\d+[.)])\s+/, "")}</p>
          </div>
        ) : (
          <p key={i} className="text-[14px] leading-relaxed text-ink">
            {b.line}
          </p>
        )
      )}
    </div>
  );
}

/**
 * Voice input, where the browser has it.
 *
 * SpeechRecognition is a real browser capability, not a service call, so this
 * costs nothing and sends nothing anywhere. It is also unevenly supported --
 * so the button is not rendered at all where the API is missing, rather than
 * shown and then failing silently when tapped.
 */
function useDictation(onText) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const Recognition =
    typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

  useEffect(() => () => recRef.current?.stop(), []);

  const toggle = useCallback(() => {
    if (!Recognition) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new Recognition();
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("");
      onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [Recognition, listening, onText]);

  return { supported: Boolean(Recognition), listening, toggle };
}

/* --- the panel --------------------------------------------------------- */

export default function ChatDock({ productId = null, productName = null, onClose }) {
  const t = useT();
  const config = useSiteConfig();
  const { isAuthed } = useAuth();
  const { pathname } = useLocation();
  const routeCtx = routeContextFor(pathname);
  // The page name and the starters the visitor SEES, in their language. The
  // English `routeCtx.description` still goes to the model -- see
  // routeContext.js for why those are two different strings.
  const pageLabel = routeLabel(t, routeCtx);
  const starters = routePrompts(t, routeCtx);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [scoped, setScoped] = useState(Boolean(productName));
  const [shared, setShared] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  // Focus mode hides the sources list and the step trace. They are the
  // point of a retrieval-backed assistant the first few times; by the tenth
  // question they are furniture between you and the answer.
  const [focus, setFocus] = useState(false);
  // The server-side conversation this panel is attached to. Null until the
  // first turn of a signed-in visitor, at which point the server creates one
  // and tells us its id on a `session` event.
  const [sessionId, setSessionId] = useState(null);
  const [loadingSession, setLoadingSession] = useState(false);
  // Controlled, because the session rows inside this menu are ordinary
  // buttons rather than DropdownMenuItems -- Radix only auto-closes for its
  // own items, so picking a conversation would leave the menu open on top of
  // the panel it just changed.
  const [menuOpen, setMenuOpen] = useState(false);
  // Today's allowance, so the composer can warn BEFORE the visitor is
  // refused. Being told "you have 3 left" is a different experience from
  // sending a message and getting a 429.
  const [quota, setQuota] = useState(null);
  // Keyed by proposal id, so a card that has been answered stays answered
  // even as the transcript re-renders around it.
  const [proposalState, setProposalState] = useState({});
  // Files staged for the NEXT message. They upload as soon as they are
  // picked, so by the time the visitor finishes typing the id is already in
  // hand and pressing send posts a few dozen bytes.
  const [attachments, setAttachments] = useState([]);
  const [dragging, setDragging] = useState(false);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const dictation = useDictation(setInput);

  // The model actually answering. Falls back to a neutral word rather than a
  // guess if /site-config has not landed yet.
  const modelLabel = config?.ai_model_label || "Assistant";
  const activeScope = scoped ? productName : null;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
    // Recomputed here as well as on scroll: an answer streaming in grows the
    // content without the visitor touching the wheel, so a scroll-only
    // update left the jump-to-latest button hidden exactly when it was
    // needed.
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => streamRef.current?.abort();
  }, []);

  const refreshQuota = useCallback(() => {
    if (!isAuthed) return;
    getQuota()
      .then(setQuota)
      .catch(() => {});
  }, [isAuthed]);

  useEffect(() => refreshQuota(), [refreshQuota]);

  /**
   * Stages files and starts uploading them immediately.
   *
   * Each one appears in the tray the moment it is picked and updates in
   * place as it uploads, so a 3MB photograph over a clinic's connection is
   * visibly happening rather than a button that does nothing for six
   * seconds. A failure stays on its own row; the others are unaffected.
   */
  const addFiles = useCallback(
    async (files) => {
      if (!isAuthed || !files?.length) return;
      setError(null);

      for (const file of Array.from(files).slice(0, MAX_ATTACHMENTS)) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const prepared = await prepareAttachment(file, t);

        if (!prepared.ok) {
          setAttachments((a) =>
            a.length >= MAX_ATTACHMENTS
              ? a
              : [...a, { key, filename: file.name, kind: "document", status: "failed", error: prepared.error }]
          );
          continue;
        }

        setAttachments((a) =>
          a.length >= MAX_ATTACHMENTS
            ? a
            : [
                ...a,
                {
                  key,
                  filename: prepared.filename,
                  kind: prepared.kind,
                  previewUrl: prepared.previewUrl,
                  status: "uploading",
                },
              ]
        );

        try {
          const saved = await uploadAttachment({
            dataUrl: prepared.dataUrl,
            filename: prepared.filename,
            session: sessionId,
          });
          setAttachments((a) =>
            a.map((item) =>
              item.key === key ? { ...item, id: saved.id, status: "ready", hasText: saved.has_text } : item
            )
          );
        } catch (err) {
          setAttachments((a) =>
            a.map((item) => (item.key === key ? { ...item, status: "failed", error: err.message } : item))
          );
        }
      }
    },
    [isAuthed, sessionId, t]
  );

  const send = useCallback(
    (question) => {
      const text = (question ?? input).trim();
      // Only files that finished uploading can be referenced; one still in
      // flight would be an id we do not have yet.
      const ready = attachments.filter((a) => a.status === "ready" && a.id);
      // A photograph on its own is a question: "what is this". The server
      // supplies the words in that case.
      if ((!text && !ready.length) || streaming) return;

      setError(null);
      setInput("");
      setAttachments([]);
      setMessages((m) => [
        ...m,
        { role: "user", text, scope: activeScope, attachments: ready },
        { role: "assistant", text: "", sources: [], suggestions: [], steps: [], thinking: "", actions: [], proposals: [], question: text, scope: activeScope },
      ]);
      setStreaming(true);

      const patchLast = (patch) =>
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          next[next.length - 1] = typeof patch === "function" ? patch(last) : { ...last, ...patch };
          return next;
        });

      const stream = streamChat({
        message: text,
        session: sessionId,
        attachmentIds: ready.map((a) => a.id),
        productId: scoped ? productId : null,
        routeContext: { description: routeCtx.description },
        onDelta: (delta) => patchLast((last) => ({ ...last, text: last.text + delta })),
        // Arrives before the first token -- this is what fills the reference
        // list and the step trace, and it was previously discarded.
        // Append, not replace. The catalogue hits arrive before the first
        // token; a web search adds more mid-turn. Deduped on kind+slug so a
        // re-sent hit does not appear twice.
        onSources: (sources) =>
          patchLast((last) => {
            const merged = [...(last.sources || [])];
            for (const s of sources || []) {
              if (!merged.some((m) => m.kind === s.kind && m.slug === s.slug)) merged.push(s);
            }
            return { ...last, sources: merged };
          }),
        onSuggestions: (suggestions) => patchLast({ suggestions }),
        // The server creates a conversation for a signed-in visitor on their
        // first turn. Adopting the id here is what keeps the NEXT message in
        // the same thread instead of starting another one.
        onEvent: (name, data) => {
          if (name === "session" && data?.id) return setSessionId(data.id);

          // The agent's live trace. Each tool_call opens a row; the matching
          // tool_result resolves it in place, which is why they are keyed by
          // the call id rather than appended blindly.
          if (name === "tool_call") {
            return patchLast((last) => ({
              ...last,
              steps: [
                ...(last.steps || []),
                { id: data.id, name: data.name, args: data.args, state: "running" },
              ],
            }));
          }
          if (name === "tool_result") {
            return patchLast((last) => ({
              ...last,
              steps: (last.steps || []).map((st) =>
                st.id === data.id
                  ? {
                      ...st,
                      state: data.ok ? "done" : "failed",
                      summary: data.summary,
                      error: data.error,
                      durationMs: data.duration_ms,
                    }
                  : st
              ),
            }));
          }
          if (name === "thinking") {
            return patchLast((last) => ({ ...last, thinking: (last.thinking || "") + data.text }));
          }
          // Prose already rendered turned out to belong to a tool-calling
          // turn. Trim exactly what the server says it emitted.
          if (name === "retract" && data?.chars > 0) {
            return patchLast((last) => ({ ...last, text: last.text.slice(0, -data.chars) }));
          }

          // Something the agent wants to happen in the browser rather than on
          // the server -- populate the compare tray, open a dialog, navigate.
          // If nothing is listening (the commerce pages are outside
          // StorefrontProvider) it comes back unhandled and becomes a card the
          // visitor can tap. Never silently dropped: they were told it
          // happened.
          // Something irreversible is being proposed. Rendered from this
          // payload alone -- the model's prose about it is not authoritative.
          if (name === "confirm_required" && data?.id) {
            return patchLast((last) => ({
              ...last,
              proposals: [...(last.proposals || []), data],
            }));
          }

          if (name === "client_action") {
            const handled = dispatchClientAction(data);
            if (!handled && data?.fallback?.to) {
              patchLast((last) => ({
                ...last,
                actions: [...(last.actions || []), data.fallback],
              }));
            }
            return undefined;
          }
        },
        onError: (err) => setError(err.message),
      });

      streamRef.current = stream;
      stream.done.finally(() => {
        setStreaming(false);
        streamRef.current = null;
        refreshQuota();
      });
    },
    [input, streaming, productId, scoped, activeScope, routeCtx.description, sessionId, refreshQuota, attachments]
  );

  function stop() {
    streamRef.current?.abort();
    setStreaming(false);
  }

  function reset() {
    streamRef.current?.abort();
    setMessages([]);
    setAttachments([]);
    setError(null);
    setFeedback({});
    setStreaming(false);
    // Detach from the stored conversation as well as clearing the screen --
    // otherwise "New chat" would keep appending to the old thread server-side
    // while showing an empty one.
    setSessionId(null);
    inputRef.current?.focus();
  }

  /** Replays a stored conversation into the panel. */
  async function openSession(session) {
    streamRef.current?.abort();
    setStreaming(false);
    setError(null);
    setFeedback({});
    setLoadingSession(true);
    try {
      const full = await getSession(session.id);
      setSessionId(full.id);
      setMessages(
        (full.messages || []).map((m) => ({
          role: m.role,
          text: m.content || "",
          sources: m.sources || [],
          suggestions: m.suggestions || [],
          // A replayed turn has no live trace to show; the question it
          // answered is the one above it.
          question: null,
          scope: null,
        }))
      );
    } catch {
      setError(t("ai.couldNotOpenConversation"));
    }
    setLoadingSession(false);
  }

  /** Drop the last question and its answer, and put the question back. */
  function undo() {
    streamRef.current?.abort();
    setStreaming(false);
    setMessages((m) => {
      const lastUser = [...m].reverse().find((x) => x.role === "user");
      if (lastUser) setInput(lastUser.text);
      // The assistant turn is always appended with its user turn, so the
      // pair comes off together -- removing only the answer would leave a
      // question the transcript claims was never replied to.
      return m.slice(0, -2);
    });
    inputRef.current?.focus();
  }

  /** Re-ask the last question. */
  function regenerate() {
    const lastUser = [...messages].reverse().find((x) => x.role === "user");
    if (!lastUser) return;
    setMessages((m) => m.slice(0, -2));
    send(lastUser.text);
  }

  /**
   * Share, meaning: put the transcript on the clipboard.
   *
   * There is no server-side conversation sharing to hand out a link to, and
   * a button that produced a URL nobody else could open would be worse than
   * no button. Copying the transcript is the part of "share" this app can
   * actually do, so that is what it does, and it says so when it is done.
   */
  function share() {
    const transcript = messages
      .map((m) => `${m.role === "user" ? "You" : ORG_NAME}: ${m.text}`)
      .join("\n\n");
    navigator.clipboard?.writeText(transcript).then(() => {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    });
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* --- header -------------------------------------------------- */}
      <header className="flex min-w-0 shrink-0 items-center gap-1.5 px-3 py-3 sm:gap-2 sm:px-5">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-1 py-0.5 text-[15px] font-black text-ink hover:bg-panel-2"
            >
              <span className="truncate">{empty ? t("ai.newChat") : t("ai.title")}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="z-[70] p-2">
            <SessionList
              isAuthed={isAuthed}
              activeId={sessionId}
              onNew={() => {
                setMenuOpen(false);
                reset();
              }}
              onOpen={(s) => {
                setMenuOpen(false);
                openSession(s);
              }}
              t={t}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={share} disabled={empty}>
              <Copy className="h-4 w-4" />
              {t("ai.copyTranscript")}
            </DropdownMenuItem>
            {/* Says plainly what "Private" above means, rather than leaving
                it as an unexplained badge. */}
            <DropdownMenuLabel className="text-[11.5px] leading-relaxed font-normal text-ink-2">
              {t("ai.privateNote")}
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11.5px] font-bold text-ink-2">
          <Lock className="h-3 w-3" />
          {t("ai.private")}
        </span>

        <div className="flex-1" />

        <IconButton label={t("ai.reset")} onClick={reset}>
          <SquarePen className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={focus ? t("ai.focusOff") : t("ai.focusOn")}
          active={focus}
          onClick={() => setFocus((v) => !v)}
        >
          <Maximize2 className="h-4 w-4" />
        </IconButton>
        <Button
          type="button"
          variant="outline"
          onClick={share}
          disabled={empty}
          className="h-9 shrink-0 cursor-pointer rounded-full border-line px-4 text-[13px] font-extrabold text-ink hover:bg-panel-2 max-sm:hidden"
        >
          {shared ? (
            <>
              <Check className="h-3.5 w-3.5 text-brand-green" />
              {t("ai.copied")}
            </>
          ) : (
            t("ai.share")
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t("ai.moreActions")}>
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[70] w-56">
            <DropdownMenuItem onClick={share} disabled={empty}>
              <Copy className="h-4 w-4" />
              {t("ai.copyTranscript")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={regenerate} disabled={empty || streaming}>
              <RotateCcw className="h-4 w-4" />
              {t("ai.regenerate")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={reset} disabled={empty} variant="destructive">
              <Trash2 className="h-4 w-4" />
              {t("ai.clear")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton label={t("common.close")} onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </header>

      {/* --- transcript ---------------------------------------------- */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
          }}
          className="h-full overflow-y-auto px-4 pt-1 pb-4 sm:px-6"
        >
          {empty ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-green/15 to-brand-blue/15 text-brand-green">
                <Sparkles size={24} />
              </span>
              <h2 className="mt-4 text-[22px] font-black text-ink">{t("ai.emptyTitle")}</h2>
              <p className="mt-1.5 max-w-[42ch] text-[13.5px] text-ink-2">
                {t("ai.onPage", { page: pageLabel })}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {starters.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="cursor-pointer rounded-full border border-line bg-panel px-3.5 py-2 text-[12.5px] font-bold text-ink-2 hover:border-brand-green/50 hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div key={i} className="flex flex-col items-end gap-1.5 pt-6">
                  {m.scope ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/10 px-2.5 py-1 text-[12px] font-bold text-violet-700 dark:text-violet-300">
                      <Sparkle className="h-3 w-3" />
                      {m.scope}
                    </span>
                  ) : null}
                  {m.attachments?.length ? <AttachmentChips items={m.attachments} /> : null}
                  <div className="flex items-center gap-2.5">
                    {m.text ? (
                      <p className="max-w-[min(38rem,100%)] rounded-2xl bg-panel-2 px-4 py-2.5 text-[14px] font-medium text-ink">
                        {m.text}
                      </p>
                    ) : null}
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-[11px] font-black text-white">
                      You
                    </span>
                  </div>
                </div>
              );
            }

            const isLast = i === messages.length - 1;
            const working = streaming && isLast;

            return (
              <div key={i} className="pt-5">
                {/* What it read, before what it said. */}
                {focus ? null : <Sources items={m.sources} onNavigate={onClose} t={t} />}

                <div className="mt-2 grid gap-1.5">
                  {focus ? null : (
                    <AgentTimeline
                      retrieval={m.sources?.length ? { count: m.sources.length } : null}
                      steps={m.steps || []}
                      thinking={m.thinking || ""}
                      busy={working}
                      t={t}
                    />
                  )}

                  {m.scope && !focus ? (
                    <div className="flex items-center gap-2 text-ink-2">
                      <Eye className="h-3.5 w-3.5" />
                      <span className="text-[13.5px] font-semibold">{t("ai.viewed")}</span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-panel-2 px-2 py-0.5 text-[12.5px] font-bold text-ink">
                        <span className="grid h-4 w-4 place-items-center rounded-[4px] bg-brand-blue text-white">
                          <Sparkle className="h-2.5 w-2.5" />
                        </span>
                        {m.scope}
                      </span>
                    </div>
                  ) : null}

                  {working ? (
                    <div role="status" className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-ink-3/40 border-t-transparent" />
                      <span
                        className="animate-shimmer bg-clip-text text-[13.5px] font-semibold text-transparent"
                        style={{
                          backgroundImage:
                            "linear-gradient(90deg, var(--color-ink-3) 0%, var(--color-ink) 45%, var(--color-ink-3) 90%)",
                          backgroundSize: "200% 100%",
                        }}
                      >
                        {m.text ? t("ai.thinking") : t("ai.generating", { topic: m.question.toLowerCase() })}
                      </span>
                    </div>
                  ) : null}
                </div>

                {m.text ? (
                  <div className="mt-3">
                    <Answer text={m.text} />
                  </div>
                ) : null}

                {m.proposals?.map((p) => (
                  <ConfirmCard
                    key={p.id}
                    proposal={p}
                    state={proposalState[p.id]}
                    onResolved={(id, status, res) => {
                      setProposalState((prev) => ({ ...prev, [id]: { status, res } }));
                      // Whatever it did, the account just changed -- the
                      // allowance chip and any open list are now stale.
                      refreshQuota();
                    }}
                    t={t}
                  />
                ))}

                {m.actions?.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.actions.map((a, ai) => (
                      <Link
                        key={`${a.to}-${ai}`}
                        to={a.to}
                        onClick={onClose}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 py-2 text-[12.5px] font-extrabold text-ink hover:border-brand-green/50"
                      >
                        {a.label}
                        <ArrowUp className="h-3.5 w-3.5 rotate-45" />
                      </Link>
                    ))}
                  </div>
                ) : null}

                {m.suggestions?.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-ink-2">
                      <Link2 className="h-3 w-3" />
                      {t("ai.basedOn")} {m.suggestions.length}{" "}
                      {m.suggestions.length === 1 ? "device" : "devices"}
                    </span>
                    {m.suggestions.map((s, si) => (
                      <div
                        key={s.slug}
                        style={{ animation: `overlayIn 380ms cubic-bezier(0.22,1,0.36,1) ${si * 90}ms both` }}
                      >
                        <AiProductCard item={s} onNavigate={onClose} />
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Actions sit under the finished answer, in the reference
                    design's order: copy, vote, regenerate, then undo. */}
                {m.text && !working ? (
                  <div className="mt-2.5 flex items-center gap-0.5">
                    <CopyButton text={m.text} label={t("common.copy")} />
                    <IconButton
                      label={t("ai.helpful")}
                      aria-pressed={feedback[i] === "up"}
                      active={feedback[i] === "up"}
                      onClick={() => setFeedback((f) => ({ ...f, [i]: f[i] === "up" ? null : "up" }))}
                    >
                      <ThumbsUp className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      label={t("ai.notHelpful")}
                      aria-pressed={feedback[i] === "down"}
                      active={feedback[i] === "down"}
                      onClick={() => setFeedback((f) => ({ ...f, [i]: f[i] === "down" ? null : "down" }))}
                    >
                      <ThumbsDown className="h-4 w-4" />
                    </IconButton>
                    <IconButton label={t("ai.regenerate")} onClick={regenerate}>
                      <AudioLines className="h-4 w-4" />
                    </IconButton>
                    {isLast ? (
                      <>
                        <Separator orientation="vertical" className="mx-1.5 h-4 bg-line" />
                        <button
                          type="button"
                          onClick={undo}
                          className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] font-bold text-ink-2 hover:bg-panel-2 hover:text-ink"
                        >
                          <Undo2 className="h-4 w-4" />
                          {t("ai.undo")}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {error ? (
            <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[12.5px] text-rose-600 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        {/* Scroll-to-bottom, only while there is something below. */}
        {!atBottom && !empty ? (
          <button
            type="button"
            onClick={() => {
              const el = scrollRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            aria-label={t("ai.scrollToLatest")}
            className="absolute bottom-3 left-1/2 grid h-8 w-8 -translate-x-1/2 cursor-pointer place-items-center rounded-full border border-line bg-panel text-ink-2 shadow-lg hover:text-ink"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* --- composer ------------------------------------------------ */}
      <div className="shrink-0 px-4 pb-3 sm:px-6">
        {/* The teaser's ceiling, stated up front rather than discovered at
            message six. Anonymous visitors keep a working assistant -- this
            says what an account adds, which is the honest sales pitch. */}
        {!isAuthed ? (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-green/25 bg-brand-green/8 px-3.5 py-2.5">
            <span className="text-[12.5px] text-ink-2">
              <Sparkles className="me-1.5 inline h-3.5 w-3.5 text-brand-green" />
              {t("ai.teaserBody")}
            </span>
            <Link
              to="/login"
              onClick={onClose}
              className="shrink-0 rounded-full bg-brand-gradient px-3 py-1.5 text-[12px] font-extrabold text-white"
            >
              {t("common.signIn")}
            </Link>
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          // Dropping a file onto the composer is the other half of the
          // paperclip. Without the dragOver handler the browser navigates
          // away to the file instead, which loses the conversation.
          onDragOver={(e) => {
            if (!isAuthed) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!isAuthed) return;
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer?.files);
          }}
          className={cn(
            "rounded-[20px] border bg-panel px-3 pt-3 pb-2 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.12)] focus-within:border-ink-3/50",
            dragging ? "border-brand-green border-dashed bg-brand-green/5" : "border-line"
          )}
        >
          {dragging ? (
            <p className="mb-2 rounded-xl bg-brand-green/10 px-3 py-2 text-center text-[12.5px] font-bold text-brand-green">
              {t("ai.attachDrop")}
            </p>
          ) : null}
          {/* The scope chip. The assistant is already pointed at this device,
              and saying so here is what stops people re-typing the product
              name into every question. Removable, because a visitor who wants
              to ask about something else should not have to close the panel. */}
          {productName && scoped ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 py-1 ps-1 pe-2 text-[12.5px] font-bold text-ink">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-blue text-white">
                  <Sparkle className="h-2.5 w-2.5" />
                </span>
                {productName}
                <button
                  type="button"
                  onClick={() => setScoped(false)}
                  aria-label={t("ai.removeScope")}
                  className="cursor-pointer text-ink-3 hover:text-ink"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          ) : null}

          <AttachmentTray
            items={attachments}
            onRemove={(key) => setAttachments((a) => a.filter((item) => item.key !== key))}
            t={t}
          />

          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line -- the convention
              // every chat interface has trained people to expect.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onPaste={(e) => {
              // Pasting a screenshot is how most people send one; making them
              // save it to disk first is a step nobody expects any more.
              const files = [...(e.clipboardData?.files || [])];
              if (files.length && isAuthed) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            placeholder={t("ai.askAnything")}
            maxLength={1000}
            className="max-h-40 w-full resize-none bg-transparent px-1 text-[14.5px] text-ink outline-none placeholder:text-ink-3"
          />

          <div className="mt-1.5 flex min-w-0 items-center gap-1">
            {/* Files and starters, behind one button. The attach item is
                shown to signed-out visitors as well and takes them to the
                sign-in -- hiding it would hide the reason to have an
                account. */}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                // Cleared so picking the SAME file twice still fires a change.
                e.target.value = "";
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={t("ai.suggestedQuestions")}>
                  <Plus className="h-4 w-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="z-[70] w-72">
                {isAuthed ? (
                  <DropdownMenuItem
                    onClick={() => fileRef.current?.click()}
                    disabled={attachments.length >= MAX_ATTACHMENTS}
                    className="text-[13px]"
                  >
                    <Paperclip className="h-4 w-4" />
                    {t("ai.attachFile")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem asChild className="text-[13px]">
                    <Link to="/login" onClick={onClose}>
                      <Paperclip className="h-4 w-4" />
                      {t("ai.attachSignIn")}
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] tracking-wide text-ink-2 uppercase">
                  {t("ai.askAboutPage")}
                </DropdownMenuLabel>
                {starters.map((s) => (
                  <DropdownMenuItem key={s} onClick={() => send(s)} className="text-[13px] whitespace-normal">
                    {s}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* The model that actually answers, read from /site-config. */}
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-panel-2 py-1.5 ps-2 pe-1.5 text-[12.5px] font-extrabold whitespace-nowrap text-ink">
              <Sparkle className="h-3.5 w-3.5 shrink-0 text-brand-blue" />
              <span className="truncate">{modelLabel}</span>
              <span className="shrink-0 rounded-md bg-panel px-1.5 py-0.5 text-[10.5px] font-bold text-ink-2 max-sm:hidden">
                {t("ai.beta")}
              </span>
            </span>

            {/* Only shown once it starts to matter. A counter that reads
                "20 of 20 left" on every visit is noise; one that appears at
                five is information. */}
            {quota && quota.remaining <= Math.max(5, Math.round(quota.limit * 0.25)) ? (
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-1 text-[11.5px] font-bold whitespace-nowrap",
                  quota.remaining === 0
                    ? "bg-red-500/10 text-red-700 dark:text-red-300"
                    : "bg-panel-2 text-ink-2"
                )}
                title={t("ai.quotaResets")}
              >
                {t("ai.quotaLeft", { remaining: quota.remaining, limit: quota.limit })}
              </span>
            ) : null}

            {productName ? (
              <IconButton
                label={t("ai.scopeTo", { name: productName })}
                active={scoped}
                onClick={() => setScoped((v) => !v)}
                className="max-sm:hidden"
              >
                <Search className="h-4 w-4" />
              </IconButton>
            ) : null}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={t("ai.moreActions")}>
                  <MoreHorizontal className="h-4 w-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="z-[70] w-56">
                <DropdownMenuItem onClick={regenerate} disabled={empty || streaming}>
                  <RotateCcw className="h-4 w-4" />
                  {t("ai.regenerate")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={share} disabled={empty}>
                  <Copy className="h-4 w-4" />
                  {t("ai.copyTranscript")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={reset} disabled={empty} variant="destructive">
                  <Trash2 className="h-4 w-4" />
                  {t("ai.clear")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex-1" />

            {shared ? (
              <span className="me-1 text-[12px] font-bold text-brand-green">{t("ai.transcriptCopied")}</span>
            ) : null}

            {dictation.supported ? (
              <IconButton
                label={dictation.listening ? t("ai.dictateStop") : t("ai.dictate")}
                active={dictation.listening}
                onClick={dictation.toggle}
                className="h-9 w-9 border border-line bg-panel-2"
              >
                <AudioLines className={cn("h-4 w-4", dictation.listening && "animate-pulse")} />
              </IconButton>
            ) : null}

            <Button
              type={streaming ? "button" : "submit"}
              onClick={streaming ? stop : undefined}
              disabled={!streaming && !input.trim() && !attachments.some((a) => a.status === "ready")}
              aria-label={streaming ? t("ai.stop") : t("ai.send")}
              size="icon"
              className="h-9 w-9 shrink-0 cursor-pointer rounded-full bg-brand-gradient text-white disabled:opacity-30"
            >
              {streaming ? <Square size={12} fill="currentColor" /> : <ArrowUp size={17} />}
            </Button>
          </div>
        </form>

        <p className="mt-2 text-center text-[11px] text-ink-3">
          {t("ai.mayBeWrong", { company: ORG_NAME })}
        </p>
      </div>
    </div>
  );
}
