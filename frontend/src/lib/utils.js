// shadcn's components all import `cn` from here. It is deliberately the same
// helper the rest of the app already uses (lib/cn.js) rather than a second,
// subtly different one -- two class-merging functions in one codebase is how
// you end up with components that behave differently depending on which
// import a file happened to pick.
export { cn } from "./cn.js";
