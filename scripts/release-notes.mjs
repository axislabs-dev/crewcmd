#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

let range = "";
try {
  const previous = git(["describe", "--tags", "--abbrev=0", "HEAD^"]);
  range = `${previous}..HEAD`;
} catch {
  range = "HEAD~20..HEAD";
}

let commits = "";
try {
  commits = git(["log", "--oneline", range]);
} catch {
  commits = git(["log", "--oneline", "--max-count=20"]);
}

console.log("## Changes");
console.log("");
console.log(commits || "- No commits found.");
