#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const postsDir = fileURLToPath(
  new URL("../src/content/posts/", import.meta.url),
);

function slugify(title) {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const reader = createInterface({ input, output });

let title = "";

try {
  title = (await reader.question("Post title: ")).trim();
} finally {
  reader.close();
}

if (!title) {
  fail("Title is required.");
}

const slug = slugify(title);

if (!slug) {
  fail("Title must contain at least one letter or number.");
}

const date = new Date().toISOString().slice(0, 10);
const filePath = join(postsDir, `${slug}.mdx`);
const editPath = relative(projectRoot, filePath);
const contents = `---
title: ${JSON.stringify(title)}
date: "${date}"
draft: true
---

`;

await mkdir(postsDir, { recursive: true });

try {
  await writeFile(filePath, contents, { flag: "wx" });
} catch (error) {
  if (error?.code === "EEXIST") {
    fail(`Post already exists: ${editPath}`);
  }

  throw error;
}

console.log(`Created ${editPath}`);
