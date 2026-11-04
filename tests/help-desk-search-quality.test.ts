import { describe, expect, it } from "vitest";
import { correctQuery, rankArticles, starterArticles } from "../app/services/help-desk-articles";
import { decide } from "../app/services/help-desk-assistant.server";
import { cases, chats, fresh, held } from "./fixtures/help-search-cases";

// How well the help center search and the chat assistant (without the AI)
// understand customers, measured on hundreds of searches written the way
// customers type them (tests/fixtures/help-search-cases.ts). Rewording starter
// articles or changing the search mustn't make it worse.

const articles = starterArticles.map((article, index) => ({ ...article, id: String(index), source: "article" as const, url: "", image: "" }));
const best = (found: { score: number }[]) => Math.max(0, ...found.map((entry) => entry.score));

// The storefront search without the database, as searchAnswers does it.
function suggestions(query: string) {
  const fixed = correctQuery(query, articles);
  const exact = rankArticles(articles, query, 6);
  const corrected = fixed ? rankArticles(articles, fixed, 6) : [];
  if (corrected.length && best(corrected) > best(exact) * 1.2) return corrected.map((entry) => entry.article.question);
  if (exact.length) return exact.map((entry) => entry.article.question);
  return rankArticles(articles, fixed ?? query, 6, { loose: true }).map((entry) => entry.article.question);
}

// The chat assistant's keyword matching, as keywordDecide does it.
function chat(text: string) {
  const fixed = correctQuery(text, articles);
  const rank = (query: string) => rankArticles(articles, query, 4).map(({ article, score, share, coverage }) => ({ answer: article, score, share, coverage }));
  const asWritten = rank(text);
  const corrected = fixed ? rank(fixed) : [];
  const useFixed = corrected.length > 0 && best(corrected) > best(asWritten) * 1.2;
  return decide(useFixed && fixed ? fixed : text, useFixed ? corrected : asWritten);
}

// Every starter article's question and each of its keywords, searched as
// written and with a slip of the finger, finds that article among the first five.
it("finds every article by each of its keywords, typos included", () => {
  const typo = (text: string, kind: number) => text.replace(/[a-z]{5,}/, (word) => kind === 0 ? word.slice(0, 2) + word.slice(3) : word.slice(0, 2) + word[3] + word[2] + word.slice(4));
  let typed = 0;
  let typedFound = 0;
  const misses: string[] = [];
  for (const article of articles) {
    for (const keyword of [article.question.toLowerCase(), ...new Set(article.keywords.split(",").map((phrase) => phrase.trim().toLowerCase()).filter(Boolean))]) {
      if (!suggestions(keyword).slice(0, 5).includes(article.question)) misses.push(`${keyword} -> ${article.question}`);
      for (const kind of [0, 1]) {
        const slipped = typo(keyword, kind);
        if (slipped === keyword) continue;
        typed++;
        if (suggestions(slipped).slice(0, 5).includes(article.question)) typedFound++;
      }
    }
  }
  expect(misses, misses.join("\n")).toEqual([]);
  expect(typedFound / typed).toBeGreaterThanOrEqual(0.99);
}, 600_000);

const sets = [["taught", cases], ["held out", held], ["never tuned on", fresh]] as const;

describe.each(sets)("Search quality: searches %s", (_name, set) => {
  it("suggests the right answer first, and always among the first five", () => {
    const misses: string[] = [];
    let first = 0;
    for (const [query, expected] of set) {
      const wants = expected.split(" | ");
      const found = suggestions(query);
      if (wants.includes(found[0])) first++;
      if (!found.slice(0, 5).some((question) => wants.includes(question))) misses.push(`${query} -> ${found[0] ?? "nothing"}`);
    }
    expect(first / set.length).toBeGreaterThanOrEqual(0.97);
    expect(misses.length / set.length, misses.join("\n")).toBeLessThanOrEqual(0.02);
  }, 120_000);

  it("never gives a wrong answer in the chat, and answers most on its own", () => {
    const wrong: string[] = [];
    let answered = 0;
    for (const [text, expected] of set) {
      const decision = chat(text);
      if (decision.kind !== "answer") continue;
      answered++;
      if (!expected.split(" | ").includes(decision.answer.question)) wrong.push(`${text} -> ${decision.answer.question}`);
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
    expect(answered / set.length).toBeGreaterThanOrEqual(0.78);
  }, 120_000);
});

// Whole chat messages, the way customers write them (long, upset, several
// things at once, Hinglish): the assistant answers nearly all on its own and
// never gives a wrong answer; the rest it asks back about.
it("understands customers' chat messages, and never answers wrongly", () => {
  const wrong: string[] = [];
  let right = 0;
  for (const [text, expected] of chats) {
    const wants = expected.split(" | ");
    const decision = chat(text);
    if (decision.kind !== "answer") { if (wants.includes("")) right++; continue; }
    if (wants.includes(decision.answer.question)) right++;
    else wrong.push(`${text} -> ${decision.answer.question}`);
  }
  expect(wrong, wrong.join("\n")).toEqual([]);
  expect(right / chats.length).toBeGreaterThanOrEqual(0.95);
}, 120_000);
