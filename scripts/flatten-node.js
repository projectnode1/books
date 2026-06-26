const fs = require("fs");
const path = require("path");

const inputDir = path.join(__dirname, "build");
const outputDir = path.join(__dirname, "flat-build");

const TEXT_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".xml",
  ".txt",
]);

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const fileMap = new Map();

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function flattenName(relPath) {
  return relPath.replace(/[\\/]/g, "__");
}

function walk(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    if (file === ".DS_Store") continue;

    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      walk(fullPath);
    } else {
      const relPath = toPosix(path.relative(inputDir, fullPath));
      fileMap.set(relPath, flattenName(relPath));
    }
  }
}

function splitUrl(url) {
  const match = url.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  return {
    pathname: match ? match[1] : url,
    suffix: `${match?.[2] || ""}${match?.[3] || ""}`,
  };
}

function isExternalOrSpecialUrl(url) {
  return (
    url === "" ||
    url.startsWith("#") ||
    url.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(url)
  );
}

function resolveOriginalPath(urlPath, fromRelPath) {
  if (urlPath.startsWith("/")) {
    return path.posix.normalize(urlPath.replace(/^\/+/, ""));
  }

  const fromDir = path.posix.dirname(fromRelPath);
  return path.posix.normalize(path.posix.join(fromDir, urlPath));
}

function flatFileForOriginalPath(originalPath) {
  if (originalPath === "." || originalPath === "") {
    return fileMap.get("index.html");
  }

  if (fileMap.has(originalPath)) {
    return fileMap.get(originalPath);
  }

  const withoutTrailingSlash = originalPath.replace(/\/+$/, "");
  const indexPath = withoutTrailingSlash
    ? `${withoutTrailingSlash}/index.html`
    : "index.html";

  if (fileMap.has(indexPath)) {
    return fileMap.get(indexPath);
  }

  return null;
}

function rewriteUrl(url, fromRelPath) {
  if (isExternalOrSpecialUrl(url)) return url;

  const { pathname, suffix } = splitUrl(url);
  if (pathname === "") return url;

  const originalPath = resolveOriginalPath(pathname, fromRelPath);
  const flatFile = flatFileForOriginalPath(originalPath);

  return flatFile ? `${flatFile}${suffix}` : url;
}

function rewriteSrcset(srcset, fromRelPath) {
  return srcset
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return entry;

      const parts = trimmed.split(/\s+/);
      parts[0] = rewriteUrl(parts[0], fromRelPath);
      return parts.join(" ");
    })
    .join(", ");
}

function rewriteHtmlUrls(content, fromRelPath) {
  content = content.replace(
    /\b(href|src)=("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, attr, raw, doubleQuoted, singleQuoted, unquoted) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted;
      const rewritten = rewriteUrl(value, fromRelPath);

      if (doubleQuoted !== undefined) return `${attr}="${rewritten}"`;
      if (singleQuoted !== undefined) return `${attr}='${rewritten}'`;
      return `${attr}=${rewritten}`;
    },
  );

  return content.replace(
    /\b(srcset)=("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, attr, raw, doubleQuoted, singleQuoted, unquoted) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted;
      const rewritten = rewriteSrcset(value, fromRelPath);

      if (doubleQuoted !== undefined) return `${attr}="${rewritten}"`;
      if (singleQuoted !== undefined) return `${attr}='${rewritten}'`;
      return `${attr}=${rewritten}`;
    },
  );
}

function rewriteCssUrls(content, fromRelPath) {
  return content.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s][^)]*?))\s*\)/gi,
    (match, doubleQuoted, singleQuoted, unquoted) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted.trim();
      const rewritten = rewriteUrl(value, fromRelPath);

      if (doubleQuoted !== undefined) return `url("${rewritten}")`;
      if (singleQuoted !== undefined) return `url('${rewritten}')`;
      return `url(${rewritten})`;
    },
  );
}

function rewriteJsStringUrls(content, fromRelPath) {
  return content.replace(
    /(["'])((?:\/|\.\.?\/)[^"'\\\s<>]+)\1/g,
    (match, quote, value) => `${quote}${rewriteUrl(value, fromRelPath)}${quote}`,
  );
}

walk(inputDir);

for (const [relPath, flatName] of fileMap.entries()) {
  const src = path.join(inputDir, relPath);
  const dest = path.join(outputDir, flatName);
  fs.copyFileSync(src, dest);
}

for (const [relPath, flatName] of fileMap.entries()) {
  const dest = path.join(outputDir, flatName);
  const ext = path.extname(dest);

  if (!TEXT_EXTENSIONS.has(ext)) continue;

  let content = fs.readFileSync(dest, "utf8");

  if (ext === ".html") {
    content = rewriteHtmlUrls(content, relPath);
  }

  if (ext === ".css" || ext === ".html") {
    content = rewriteCssUrls(content, relPath);
  }

  if (ext === ".js" || ext === ".json" || ext === ".html") {
    content = rewriteJsStringUrls(content, relPath);
  }

  fs.writeFileSync(dest, content);
}

console.log(`Flattened build written to: ${outputDir}`);
