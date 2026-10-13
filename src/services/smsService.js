import { config } from "../config.js";

// SMS transport, provider-pluggable.
//
// Deliberately not Twilio: this is an Iranian company sending to Iranian
// mobile numbers, and Twilio does not serve Iran. The realistic providers
// are the domestic ones (Kavenegar, SMS.ir), which both expose a single
// GET/POST send endpoint -- so the same "plain fetch, no SDK" approach the
// email service already takes applies here.
//
// With no provider configured this logs instead of sending, mirroring
// emailService's fallback. That keeps dev and test runnable without
// credentials, and makes the queue's behaviour observable end to end.

const PROVIDERS = {
  // https://kavenegar.com -- simple GET, token in the path.
  async kavenegar({ apiKey, sender }, to, message) {
    const url =
      `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/sms/send.json` +
      `?receptor=${encodeURIComponent(to)}&message=${encodeURIComponent(message)}` +
      (sender ? `&sender=${encodeURIComponent(sender)}` : "");
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`Kavenegar send failed: ${res.status} ${await res.text().catch(() => "")}`);
    return { sent: true, provider: "kavenegar" };
  },

  // https://sms.ir -- JSON POST, key in a header.
  async smsir({ apiKey, sender }, to, message) {
    const res = await fetch("https://api.sms.ir/v1/send/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ lineNumber: sender, messageText: message, mobiles: [to] }),
    });
    if (!res.ok) throw new Error(`SMS.ir send failed: ${res.status} ${await res.text().catch(() => "")}`);
    return { sent: true, provider: "smsir" };
  },
};

export const smsService = {
  providers: Object.keys(PROVIDERS),

  async send(to, message) {
    const { smsProvider, smsApiKey, smsSender } = config;

    if (!smsProvider || !smsApiKey) {
      console.log(`[sms] (no provider configured) to ${to}: ${message}`);
      return { sent: false, provider: null };
    }

    const send = PROVIDERS[smsProvider];
    if (!send) {
      throw new Error(`Unknown SMS_PROVIDER '${smsProvider}'. Supported: ${Object.keys(PROVIDERS).join(", ")}`);
    }
    return send({ apiKey: smsApiKey, sender: smsSender }, to, message);
  },
};
