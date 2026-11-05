#!/usr/bin/env node
// Builds the Recovery Kitchen guide pages and lunch recipes from content/*.md
// and writes them into the <generated:...> blocks in index.html.
// Text is copied as written; only markdown syntax is converted to HTML.
// Usage: node scripts/build-kitchen-content.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTENT = path.join(ROOT, "content");
const INDEX = path.join(ROOT, "index.html");

const GUIDE_GROUPS = [
  ["Kitchen Basics", ["healing-pantry-guide", "healing-cookware-guide", "cooking-methods-guide", "salt-guide"]],
  ["Ingredients", ["fruit-timing-guide", "fruit-pairings-guide", "ezekiel-bread-benefits", "whole-grains-guide",
                   "beans-and-peas-guide", "nuts-and-seeds-guide", "plant-protein-guide"]],
  ["Breakfast", ["breakfast-guide"]],
  ["Lunch", ["plant-based-lunches-guide"]],
];

// Only tools the recipe text names. Anything not listed here has no equipment field.
const LUNCH_EQUIPMENT = {
  "Quinoa Salad Jars": ["Mason jar"],
  "Sweet Potato Shepherd's Pie": ["Baking dish"],
  "Simple Hummus": ["Food processor"],
  "Mason Jar Lentil Soup": ["Mason jar", "Pot", "Thermos"],
  "Mixed Legume Loaf": ["Loaf dish"],
};

const read = (name) => fs.readFileSync(path.join(CONTENT, name + ".md"), "utf8").replace(/\r\n/g, "\n");

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

const stripInline = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");

// Line by line, since headings and lists often start right under a paragraph
// with no blank line. Handles headings, lists, rules and paragraphs.
function toHtml(md) {
  const out = [];
  let para = [], list = null;
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    para = []; list = null;
  };
  for (const line of md.trim().split("\n")) {
    const h = line.match(/^(#{2,3}) (.+)$/);
    const ul = line.match(/^[-*] (.+)$/);
    const ol = line.match(/^\d+\. (.+)$/);
    if (!line.trim()) flush();
    else if (/^-{3,}$/.test(line.trim())) { flush(); out.push("<hr>"); }
    else if (h) { flush(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); }
    else if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (para.length || (list && list.tag !== tag)) flush();
      if (!list) list = { tag, items: [] };
      list.items.push((ul || ol)[1]);
    }
    else { if (list) flush(); para.push(line); }
  }
  flush();
  return out.join("");
}

function splitTitle(md) {
  const m = md.match(/^# (.+)\n/);
  return { title: m[1].trim(), body: md.slice(m[0].length) };
}

function firstSentence(text) {
  const plain = stripInline(text).replace(/\s+/g, " ").trim();
  const m = plain.match(/^.+?[.!?](?=\s|$)/);
  return m ? m[0] : plain;
}

function buildGuides() {
  const out = [];
  for (const [group, ids] of GUIDE_GROUPS) {
    for (const id of ids) {
      const { title, body } = splitTitle(read(id));
      const intro = body.trim().split(/\n{2,}/).find((b) => !/^(#|[-*] |\d+\. )/.test(b));
      out.push({ id, group, title, desc: firstSentence(intro), html: toHtml(body) });
    }
  }
  return out;
}

function lunchRecipe(name, paragraphs) {
  // A bold label ("For the topping:") isn't part of the sentence, so leave it out of the card text
  const descSource = paragraphs[0].replace(/^\*\*[^*]+:\*\*\s*/, "");
  const r = { name, tag: "Plant-Based Lunch", desc: firstSentence(descSource) };
  if (LUNCH_EQUIPMENT[name]) r.equipment = LUNCH_EQUIPMENT[name];
  r.steps = paragraphs.map(inline);
  return r;
}

function buildLunches() {
  const recipes = [];
  // "Lunch Ideas to Try": each idea is a bold title line followed by its prose
  const ideas = read("plant-based-lunches-guide").split("## Lunch Ideas to Try")[1];
  for (const block of ideas.trim().split(/\n{2,}/)) {
    const m = block.match(/^\*\*(.+?)\*\*\n([\s\S]+)$/);
    if (m) recipes.push(lunchRecipe(m[1], [m[2].trim()]));
  }
  // more-plant-based-lunches: each "## Name" section is a recipe, until the closing notes
  const more = read("more-plant-based-lunches");
  for (const section of more.split(/^## /m).slice(1)) {
    const [heading, ...rest] = section.split("\n");
    if (heading.startsWith("Why Prep Lunches")) break;
    const paragraphs = rest.join("\n").split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && p !== "---");
    recipes.push(lunchRecipe(heading.trim(), paragraphs));
  }
  return recipes;
}

// Matches the hand-written entries: one field group per line, double-quoted strings
const str = (s) => JSON.stringify(s);
const arr = (a) => `[${a.map(str).join(",")}]`;

function recipeEntry(r) {
  const lines = [`    name:${str(r.name)},tag:${str(r.tag)},`, `    desc:${str(r.desc)},`];
  if (r.equipment) lines.push(`    equipment:${arr(r.equipment)},`);
  lines.push(`    steps:${arr(r.steps)}`);
  return `  {\n${lines.join("\n")}\n  },`;
}

function guideEntry(g) {
  return `  {\n    id:${str(g.id)},group:${str(g.group)},title:${str(g.title)},\n    desc:${str(g.desc)},\n    html:${str(g.html)}\n  },`;
}

function replaceBlock(html, name, body) {
  const re = new RegExp(`(  // <generated:${name}>[^\\n]*\\n)[\\s\\S]*?(  // </generated:${name}>)`);
  if (!re.test(html)) throw new Error(`marker <generated:${name}> not found in index.html`);
  return html.replace(re, (_, open, close) => `${open}${body ? body + "\n" : ""}${close}`);
}

const lunches = buildLunches();
const guides = buildGuides();
let html = fs.readFileSync(INDEX, "utf8");
html = replaceBlock(html, "lunch-recipes", lunches.map(recipeEntry).join("\n"));
html = replaceBlock(html, "guides", guides.map(guideEntry).join("\n"));
fs.writeFileSync(INDEX, html);
console.log(`${lunches.length} lunch recipes, ${guides.length} guides written to index.html`);
