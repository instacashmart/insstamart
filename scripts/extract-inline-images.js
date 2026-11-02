import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const bundlePath = resolve("dist", "app.js");
const imageDirectory = resolve("dist", "assets", "embedded-images");
const imageUrlPrefix = "/assets/embedded-images/";
const extensionByMime = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};
const bundle = await readFile(bundlePath, "utf8");
const assets = new Map();
let extractedCount = 0;

const optimizedBundle = bundle.replace(
  /data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=_-]+)/g,
  (dataUrl, mimeType, encodedImage) => {
    const extension = extensionByMime[mimeType];
    if (!extension) {
      throw new Error(`Unsupported embedded image format: ${mimeType}`);
    }

    const image = Buffer.from(encodedImage, "base64");
    const digest = createHash("sha256").update(image).digest("hex");
    const filename = `${digest}.${extension}`;
    assets.set(filename, image);
    extractedCount += 1;
    return `${imageUrlPrefix}${filename}`;
  },
);

if (extractedCount === 0) {
  throw new Error("No embedded images were found in dist/app.js.");
}

await mkdir(imageDirectory, { recursive: true });
await Promise.all(
  [...assets].map(([filename, image]) =>
    writeFile(resolve(imageDirectory, filename), image),
  ),
);
await writeFile(bundlePath, optimizedBundle);

console.log(
  `Extracted ${extractedCount} embedded images (${assets.size} unique) from app.js.`,
);
