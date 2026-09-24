/** Public URL prefix. Docker/nginx and local Vite use `/`. GitHub Pages project sites need `/<repo>/`. */
export function publicBase(env: { GITHUB_PAGES?: string; GITHUB_REPOSITORY?: string }): string {
  if (env.GITHUB_PAGES === "true") {
    const repo = (env.GITHUB_REPOSITORY || "iphonetikpr/Moldmaker").split("/")[1] || "Moldmaker";
    return `/${repo}/`;
  }
  return "/";
}
