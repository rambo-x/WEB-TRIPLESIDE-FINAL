import React from "react";
import { useLocation } from "react-router-dom";
import SEO, {
  INDEX_ROBOTS,
  NOINDEX_ROBOTS,
  SITE_URL,
} from "./SEO";

const ROUTES = {
  "/": {
    title: "Music Production, Studio Gear & Audio Plugins | TripleSide Studio",
    description:
      "Explore original music, trusted studio gear, VST instruments, sample packs, presets, and production tools from TripleSide Studio.",
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `${SITE_URL}/#organization`,
          name: "TripleSide Studio",
          url: `${SITE_URL}/`,
          logo: {
            "@type": "ImageObject",
            url: `${SITE_URL}/favicon.svg`,
          },
        },
        {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          url: `${SITE_URL}/`,
          name: "TripleSide Studio",
          alternateName: "TripleSideStudio.com",
          publisher: { "@id": `${SITE_URL}/#organization` },
          inLanguage: "en",
        },
      ],
    },
  },
  "/songs": {
    title: "Original Music & Audio Catalog",
    description:
      "Listen to original productions, live recordings, collaborations, and selected releases from TripleSide Studio.",
  },
  "/gear": {
    title: "Studio Gear & Music Production Equipment",
    description:
      "Discover the instruments, recording equipment, and production tools used to shape sound at TripleSide Studio.",
  },
  "/shop": {
    title: "VST Plugins, Sample Packs & Audio Production Tools",
    description:
      "Shop VST instruments, sample packs, presets, and project templates built for producers and music creators.",
  },
  "/blog": {
    title: "Music Production Tips, Gear & Studio Journal",
    description:
      "Read production tutorials, studio gear insights, audio plugin guides, and behind-the-scenes stories from TripleSide Studio.",
  },
};

const PRIVATE_ROUTES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/dashboard",
  "/payment",
  "/admin",
];

export default function RouteSEO() {
  const { pathname } = useLocation();
  const exact = ROUTES[pathname];

  if (exact) {
    return (
      <SEO
        {...exact}
        path={pathname}
        robots={INDEX_ROBOTS}
      />
    );
  }

  if (pathname.startsWith("/shop/")) {
    return (
      <SEO
        title="Digital Audio Product"
        description="Explore this digital audio product from TripleSide Studio."
        path={pathname}
      />
    );
  }

  if (pathname.startsWith("/blog/")) {
    return (
      <SEO
        title="TripleSide Studio Journal"
        description="Read music production insights and studio stories from TripleSide Studio."
        path={pathname}
        type="article"
      />
    );
  }

  const isPrivate = PRIVATE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return (
    <SEO
      title={isPrivate ? "Secure Account Area" : "Page Not Found"}
      description={
        isPrivate
          ? "Secure customer or administration page for TripleSide Studio."
          : "The requested page could not be found."
      }
      path={pathname}
      robots={NOINDEX_ROBOTS}
    />
  );
}
