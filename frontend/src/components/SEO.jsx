import { useEffect } from "react";

export const SITE_URL = "https://triplesidestudio.com";
export const SITE_NAME = "TripleSide Studio";
export const DEFAULT_SOCIAL_IMAGE =
  "https://images.pexels.com/photos/10933686/pexels-photo-10933686.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=630&w=1200";
export const INDEX_ROBOTS =
  "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
export const NOINDEX_ROBOTS = "noindex, nofollow, noarchive";

const upsertMeta = (attribute, key, content) => {
  if (!content) return;
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", String(content));
};

const upsertCanonical = (href) => {
  let element = document.head.querySelector('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
};

const absoluteUrl = (value) => {
  if (!value) return DEFAULT_SOCIAL_IMAGE;
  try {
    return new URL(value, SITE_URL).toString();
  } catch {
    return DEFAULT_SOCIAL_IMAGE;
  }
};

export default function SEO({
  title,
  description,
  path,
  image = DEFAULT_SOCIAL_IMAGE,
  type = "website",
  robots = INDEX_ROBOTS,
  structuredData,
}) {
  useEffect(() => {
    const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
    const requestedPath = path || window.location.pathname || "/";
    const normalizedPath =
      requestedPath === "/" ? "/" : requestedPath.replace(/\/+$/, "");
    const canonical = new URL(normalizedPath, SITE_URL).toString();
    const socialImage = absoluteUrl(image);

    document.title = fullTitle;
    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", robots);
    upsertMeta("name", "googlebot", robots);
    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:locale", "en_US");
    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:title", fullTitle);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", canonical);
    upsertMeta("property", "og:image", socialImage);
    upsertMeta("property", "og:image:alt", `${fullTitle} cover`);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", socialImage);
    upsertCanonical(canonical);

    const scriptId = "route-structured-data";
    document.getElementById(scriptId)?.remove();
    if (structuredData) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(structuredData).replace(/</g, "\\u003c");
      document.head.appendChild(script);
    }
  }, [title, description, path, image, type, robots, structuredData]);

  return null;
}
