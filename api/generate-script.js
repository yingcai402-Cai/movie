export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    response.status(200).json({ script: "" });
    return;
  }

  try {
    const { category, title, month, theme, purpose, publishAt } = request.body || {};
    const prompt = `请为筑峰短视频宣传工作台生成一份商务风短视频脚本。\n分类：${category || "未分类"}\n月份：${month || "未设置"}\n主题名称：${title || "未命名主题"}\n视频主题：${theme || "未填写"}\n主旨：${purpose || "未填写"}\n预计发布时间：${publishAt || "未设置"}\n\n要求：中文输出；结构包含镜头段落、旁白/字幕、素材建议、结尾行动引导；时长控制在45-60秒；语气专业简洁。`;

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: prompt,
      }),
    });

    if (!upstream.ok) {
      response.status(200).json({ script: "" });
      return;
    }

    const data = await upstream.json();
    const script = data.output_text || extractOutputText(data) || "";
    response.status(200).json({ script });
  } catch (_error) {
    response.status(200).json({ script: "" });
  }
}

function extractOutputText(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("\n");
}
