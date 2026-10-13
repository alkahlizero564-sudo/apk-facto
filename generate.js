const fs = require("fs");
const path = require("path");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lines = fs.readFileSync("request.txt", "utf8").trim().split("\n");
const name = (lines.shift() || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
const request = lines.join("\n").trim();
if (!name || !request) {
  console.error("السطر الأول اسم التطبيق (إنجليزي) والباقي الوصف");
  process.exit(1);
}

const dir = path.join("apps", name);
const FILE = path.join(dir, "index.html");
const existing = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "";

const system =
  "You are an expert web developer. Output ONE complete, self-contained HTML file " +
  "(inline CSS and JS), mobile-friendly, with RTL Arabic support when the request is in Arabic. " +
  "Reply with ONLY the full file inside a single ```html code block. No explanations.";

const prompt = existing
  ? `Here is the current app:\n\`\`\`html\n${existing}\n\`\`\`\n\nApply this change and return the FULL updated file:\n${request}`
  : `Create this app:\n${request}`;

async function callClaude() {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.content.map((c) => c.text || "").join("");
}

async function callGemini() {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    }
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.candidates[0].content.parts.map((p) => p.text || "").join("");
}

function extract(text) {
  let code = text;
  const s = text.indexOf("```");
  if (s !== -1) {
    const after = text.indexOf("\n", s) + 1;
    const e = text.lastIndexOf("```");
    code = text.slice(after, e > after ? e : undefined);
  }
  code = code.trim();
  if (!/<html|<!doctype/i.test(code)) throw new Error("الرد ما فيه HTML صالح");
  return code;
}

async function tryProvider(fn, label, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      return extract(await fn());
    } catch (e) {
      console.log(`${label} المحاولة ${i} فشلت: ${String(e).slice(0, 200)}`);
      if (i < tries) await sleep(3000 * i);
    }
  }
  return null;
}

(async () => {
  const order = process.env.AI_PROVIDER === "gemini"
    ? [["Gemini", callGemini, "GEMINI_API_KEY"], ["Claude", callClaude, "ANTHROPIC_API_KEY"]]
    : [["Claude", callClaude, "ANTHROPIC_API_KEY"], ["Gemini", callGemini, "GEMINI_API_KEY"]];

  for (const [label, fn, key] of order) {
    if (!process.env[key]) continue;
    const code = await tryProvider(fn, label);
    if (code) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(FILE, code);
      console.log(`تم: ${FILE} بواسطة ${label}`);
      return;
    }
  }
  console.error("فشل التوليد من كل المزودين");
  process.exit(1);
})();
