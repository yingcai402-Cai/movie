export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const webhook = process.env.WECOM_BOT_WEBHOOK;
  if (!webhook) {
    response.status(200).json({ ok: false, error: "WECOM_BOT_WEBHOOK is not configured" });
    return;
  }

  try {
    const { message } = request.body || {};
    if (!message) {
      response.status(400).json({ ok: false, error: "Missing message" });
      return;
    }

    const upstream = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content: message },
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    response.status(200).json({ ok: upstream.ok && data.errcode === 0, data });
  } catch (error) {
    response.status(200).json({ ok: false, error: error.message });
  }
}
