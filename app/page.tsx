"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Post = {
  title?: string;
  author_name?: string;
  created_at?: string | number;
  document?: string;
  raw?: {
    document?: string;
    content?: string; // XML-ish content
  };
  cluster_metadata?: {
    model_ids?: string[];
    topic_category_ids?: string[];
    post_type_category_ids?: string[];
  };
};

type ParsedXML = {
  images: string[];
  files: string[];
  links: { url: string; text?: string }[];
};

type ActiveFilters = {
  title: string;
  author: string;
  models: Set<string>;
  topics: Set<string>;
  assignments: Set<string>;
};

function safeDate(input: any): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseJSONL(text: string): Post[] {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  return lines.map((line) => JSON.parse(line));
}

function parseXMLContent(xmlContent: string): ParsedXML {
  // Browser-only (this is a client component)
  const result: ParsedXML = { images: [], files: [], links: [] };
  if (!xmlContent?.trim()) return result;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, "text/xml");

    const walk = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName?.toLowerCase();

        if (tag === "image") {
          const src = el.getAttribute("src");
          if (src) result.images.push(src);
        } else if (tag === "file") {
          const url = el.getAttribute("url");
          if (url) result.files.push(url);
        } else if (tag === "link") {
          const href = el.getAttribute("href");
          const text = el.textContent ?? undefined;
          if (href) result.links.push({ url: href, text });
        }
      }

      node.childNodes?.forEach(walk);
    };

    doc.childNodes.forEach(walk);
  } catch {
    // swallow parse errors; just return empty-ish result
  }

  return result;
}

function normalizeTagLabel(tag: string) {
  return (tag ?? "").replace(/_/g, " ");
}

export default function PostsExplorerPage() {
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [filteredPosts, setFilteredPosts] = useState<Post[]>([]);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Fetching data...");
  const [progress, setProgress] = useState(0);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const [filters, setFilters] = useState<ActiveFilters>({
    title: "",
    author: "",
    models: new Set(),
    topics: new Set(),
    assignments: new Set(),
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-load data on mount: fetch /posts.jsonl from public/
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setLoadError(null);
        setStatusText("Fetching posts.jsonl...");
        setProgress(30);

        const res = await fetch("/posts.jsonl", { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load posts.jsonl: ${res.status} ${res.statusText}`);

        setStatusText("Parsing data...");
        setProgress(60);

        const text = await res.text();
        const posts = parseJSONL(text);

        setStatusText("Initializing filters...");
        setProgress(90);

        if (cancelled) return;
        setAllPosts(posts);
        setFilteredPosts(posts);
        setFiltersOpen(true);
        setStatsOpen(true);

        setProgress(100);
        setTimeout(() => {
          if (!cancelled) setLoading(false);
        }, 300);
      } catch (e: any) {
        if (cancelled) return;
        setLoadError(e?.message ?? String(e));
        setLoading(false);
        setProgress(0);
        setStatusText("Error loading data.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build available tags from allPosts
  const tagUniverse = useMemo(() => {
    const models = new Set<string>();
    const topics = new Set<string>();
    const assignments = new Set<string>();

    for (const post of allPosts) {
      const cm = post.cluster_metadata;
      cm?.model_ids?.forEach((m) => models.add(m));
      cm?.topic_category_ids?.forEach((t) => topics.add(t));
      cm?.post_type_category_ids?.forEach((a) => assignments.add(a));
    }

    return {
      models: Array.from(models).sort(),
      topics: Array.from(topics).sort(),
      assignments: Array.from(assignments).sort(),
    };
  }, [allPosts]);

  // Apply filters whenever filters or allPosts change
  useEffect(() => {
    const titleQ = filters.title.trim().toLowerCase();
    const authorQ = filters.author.trim().toLowerCase();

    const next = allPosts.filter((post) => {
      if (titleQ && !post.title?.toLowerCase().includes(titleQ)) return false;
      if (authorQ && !post.author_name?.toLowerCase().includes(authorQ)) return false;

      const postModels = post.cluster_metadata?.model_ids ?? [];
      const postTopics = post.cluster_metadata?.topic_category_ids ?? [];
      const postAssignments = post.cluster_metadata?.post_type_category_ids ?? [];

      if (filters.models.size > 0) {
        let ok = false;
        for (const m of filters.models) if (postModels.includes(m)) ok = true;
        if (!ok) return false;
      }

      if (filters.topics.size > 0) {
        let ok = false;
        for (const t of filters.topics) if (postTopics.includes(t)) ok = true;
        if (!ok) return false;
      }

      if (filters.assignments.size > 0) {
        let ok = false;
        for (const a of filters.assignments) if (postAssignments.includes(a)) ok = true;
        if (!ok) return false;
      }

      return true;
    });

    setFilteredPosts(next);
  }, [filters, allPosts]);

  function toggleSetFilter(kind: "models" | "topics" | "assignments", value: string) {
    setFilters((prev) => {
      const next = {
        ...prev,
        [kind]: new Set(prev[kind]),
      } as ActiveFilters;

      if (next[kind].has(value)) next[kind].delete(value);
      else next[kind].add(value);

      return next;
    });
  }

  function clearFilters() {
    setFilters({
      title: "",
      author: "",
      models: new Set(),
      topics: new Set(),
      assignments: new Set(),
    });
  }

  async function handleFileUpload(file: File) {
    try {
      setLoadError(null);
      setLoading(true);
      setStatusText("Reading file...");
      setProgress(40);

      const text = await file.text();
      setStatusText("Parsing data...");
      setProgress(70);

      let posts: Post[] = [];
      const lines = text.trim().split("\n");
      if (lines.length > 1 || file.name.toLowerCase().endsWith(".jsonl")) {
        posts = parseJSONL(text);
      } else {
        const data = JSON.parse(text);
        posts = Array.isArray(data) ? data : [data];
      }

      setStatusText("Initializing filters...");
      setProgress(90);

      setAllPosts(posts);
      setFilteredPosts(posts);
      setFiltersOpen(true);
      setStatsOpen(true);

      setProgress(100);
      setTimeout(() => setLoading(false), 250);
    } catch (e: any) {
      setLoadError(e?.message ?? String(e));
      setLoading(false);
      setProgress(0);
    }
  }

  // Modal content renderer (text + images insertion heuristic)
  const modalContent = useMemo(() => {
    if (!selectedPost) return null;

    const xml = selectedPost.raw?.content ?? "";
    const parsed = parseXMLContent(xml);

    const documentText = selectedPost.document ?? selectedPost.raw?.document ?? "";
    const lines = documentText ? documentText.split("\n") : [];

    const blocks: React.ReactNode[] = [];
    let imageIndex = 0;

    if (documentText && parsed.images.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim() ?? "";
        const nextLine = (i < lines.length - 1 ? lines[i + 1] : "")?.trim?.() ?? "";

        if (line) {
          blocks.push(<p key={`p-${i}`}>{line}</p>);
        }

        const shouldInsert =
          imageIndex < parsed.images.length &&
          (nextLine === "" ||
            nextLine.startsWith("Output") ||
            nextLine.startsWith("Analysis") ||
            line.endsWith(":") ||
            nextLine.startsWith("Prompt"));

        if (shouldInsert) {
          const src = parsed.images[imageIndex++];
          blocks.push(
            // eslint-disable-next-line @next/next/no-img-element
            <img key={`img-${i}-${imageIndex}`} src={src} alt={`Image ${imageIndex}`} />
          );
        }
      }

      while (imageIndex < parsed.images.length) {
        const src = parsed.images[imageIndex++];
        blocks.push(
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`img-tail-${imageIndex}`} src={src} alt={`Image ${imageIndex}`} />
        );
      }
    } else if (documentText) {
      const paragraphs = documentText
        .split("\n\n")
        .map((p) => p.trim())
        .filter(Boolean);

      paragraphs.forEach((para, idx) => {
        const parts = para.split("\n");
        blocks.push(
          <p key={`para-${idx}`}>
            {parts.map((part, j) => (
              <React.Fragment key={`${idx}-${j}`}>
                {part}
                {j < parts.length - 1 ? <br /> : null}
              </React.Fragment>
            ))}
          </p>
        );
      });
    }

    // Links
    const linkBlocks =
      parsed.links.length > 0
        ? parsed.links.map((l, idx) => (
            <div className="linkBox" key={`link-${idx}`}>
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.text?.trim() ? l.text : l.url}
              </a>
            </div>
          ))
        : null;

    // PDFs / files
    const fileBlocks =
      parsed.files.length > 0
        ? parsed.files.map((url, idx) => (
            <div className="pdfEmbed" key={`pdf-${idx}`}>
              <h4>📄 PDF Document {idx + 1}</h4>
              <iframe src={url} title={`PDF ${idx + 1}`} />
              <div className="linkBox">
                <a href={url} target="_blank" rel="noreferrer">
                  Open PDF in new tab →
                </a>
              </div>
            </div>
          ))
        : null;

    return (
      <>
        {blocks.length > 0 ? blocks : <p style={{ color: "#999" }}>No content available for this post.</p>}
        {linkBlocks}
        {fileBlocks}
      </>
    );
  }, [selectedPost]);

  return (
    <div className="page">
      <div className="container">
        <div className="header">
          <h1>📚 Posts Explorer</h1>

          {loading ? (
            <div className="uploadSection">
              <p className="muted" style={{ marginBottom: 10 }}>
                {loadError ? "⚠️ Could not load posts.jsonl" : "Loading posts data..."}
              </p>

              {loadError ? (
                <>
                  <p className="mutedSmall" style={{ marginBottom: 12 }}>
                    {loadError}
                    <br />
                    Make sure <code>posts.jsonl</code> is in <code>public/</code> (served at <code>/posts.jsonl</code>), or upload
                    manually below.
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jsonl,.json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                    }}
                  />
                  <button className="uploadBtn" onClick={() => fileInputRef.current?.click()}>
                    📁 Upload JSONL File
                  </button>
                </>
              ) : (
                <div style={{ marginTop: 15 }}>
                  <div className="progressOuter">
                    <div className="progressInner" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mutedSmall" style={{ marginTop: 10 }}>
                    {statusText}
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className={`filters ${filtersOpen ? "active" : ""}`}>
          <h2 style={{ marginBottom: 20, color: "#2c3e50" }}>🔍 Filters</h2>

          <div className="filterGrid">
            <div className="filterGroup">
              <label>Search Title</label>
              <input
                value={filters.title}
                onChange={(e) => setFilters((p) => ({ ...p, title: e.target.value }))}
                placeholder="Search by title..."
              />
            </div>

            <div className="filterGroup">
              <label>Search Author</label>
              <input
                value={filters.author}
                onChange={(e) => setFilters((p) => ({ ...p, author: e.target.value }))}
                placeholder="Search by author name..."
              />
            </div>
          </div>

          <div className="filterGroup">
            <label>Model Tags</label>
            <div className="tagFilters">
              {tagUniverse.models.length === 0 ? (
                <span className="mutedSmall">No tags available</span>
              ) : (
                tagUniverse.models.map((tag) => (
                  <button
                    type="button"
                    key={`m-${tag}`}
                    className={`tagFilter ${filters.models.has(tag) ? "active" : ""}`}
                    onClick={() => toggleSetFilter("models", tag)}
                  >
                    {normalizeTagLabel(tag)}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="filterGroup">
            <label>Topic Tags</label>
            <div className="tagFilters">
              {tagUniverse.topics.length === 0 ? (
                <span className="mutedSmall">No tags available</span>
              ) : (
                tagUniverse.topics.map((tag) => (
                  <button
                    type="button"
                    key={`t-${tag}`}
                    className={`tagFilter ${filters.topics.has(tag) ? "active" : ""}`}
                    onClick={() => toggleSetFilter("topics", tag)}
                  >
                    {normalizeTagLabel(tag)}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="filterGroup">
            <label>Assignment Tags</label>
            <div className="tagFilters">
              {tagUniverse.assignments.length === 0 ? (
                <span className="mutedSmall">No tags available</span>
              ) : (
                tagUniverse.assignments.map((tag) => (
                  <button
                    type="button"
                    key={`a-${tag}`}
                    className={`tagFilter ${filters.assignments.has(tag) ? "active" : ""}`}
                    onClick={() => toggleSetFilter("assignments", tag)}
                  >
                    {normalizeTagLabel(tag)}
                  </button>
                ))
              )}
            </div>
          </div>

          <button className="clearFilters" onClick={clearFilters}>
            Clear All Filters
          </button>
        </div>

        <div className={`stats ${statsOpen ? "active" : ""}`}>
          <div className="statsContent">
            <div className="statItem">
              Showing <strong>{filteredPosts.length}</strong> of <strong>{allPosts.length}</strong> posts
            </div>
          </div>
        </div>

        {filteredPosts.length === 0 ? (
          <div className="noResults">No posts match your filters. Try adjusting your search criteria.</div>
        ) : (
          <div className="postsGrid">
            {filteredPosts.map((post, idx) => {
              const models = post.cluster_metadata?.model_ids ?? [];
              const topics = post.cluster_metadata?.topic_category_ids ?? [];
              const assignments = post.cluster_metadata?.post_type_category_ids ?? [];

              const documentText = post.document ?? post.raw?.document ?? "";
              const preview = documentText ? `${documentText.slice(0, 200)}...` : "No content available";

              const d = safeDate(post.created_at);
              const dateStr = d ? d.toLocaleDateString() : "Unknown date";

              return (
                <button
                  key={`post-${idx}`}
                  className="postCard"
                  onClick={() => setSelectedPost(post)}
                  type="button"
                  aria-label={`Open post: ${post.title ?? "Untitled"}`}
                >
                  <div className="postHeader">
                    <div className="postTitle">{post.title ?? "Untitled"}</div>
                    <div className="postAuthor">👤 {post.author_name ?? "Unknown Author"}</div>
                    <div className="postDate">📅 {dateStr}</div>
                  </div>

                  <div className="postBody">{preview}</div>

                  <div className="postTags">
                    {models.map((m) => (
                      <span key={`m-${idx}-${m}`} className="tag model">
                        {m}
                      </span>
                    ))}
                    {topics.map((t) => (
                      <span key={`t-${idx}-${t}`} className="tag topic">
                        {normalizeTagLabel(t)}
                      </span>
                    ))}
                    {assignments.map((a) => (
                      <span key={`a-${idx}-${a}`} className="tag">
                        {normalizeTagLabel(a)}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      <div
        className={`modal ${selectedPost ? "active" : ""}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).classList.contains("modal")) setSelectedPost(null);
        }}
        role="dialog"
        aria-modal="true"
      >
        {selectedPost ? (
          <div className="modalContent">
            <button className="closeBtn" onClick={() => setSelectedPost(null)} aria-label="Close modal">
              ×
            </button>

            <div className="modalHeader">
              <div className="modalTitle">{selectedPost.title ?? "Untitled"}</div>
              <div className="postAuthor">👤 {selectedPost.author_name ?? "Unknown Author"}</div>
              <div className="postDate">
                📅 {safeDate(selectedPost.created_at)?.toLocaleDateString() ?? "Unknown date"}
              </div>
            </div>

            <div className="modalBody">{modalContent}</div>
          </div>
        ) : null}
      </div>

      {/* Styles (ported from your HTML) */}
      <style jsx>{`
        * {
          box-sizing: border-box;
        }
        .page {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          max-width: 1400px;
          margin: 0 auto;
        }
        .header {
          background: white;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          margin-bottom: 20px;
        }
        h1 {
          color: #2c3e50;
          margin-bottom: 20px;
        }
        .uploadSection {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
          border: 2px dashed #667eea;
          text-align: center;
        }
        .uploadBtn {
          background: #667eea;
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 600;
          margin-top: 10px;
        }
        .uploadBtn:hover {
          background: #5568d3;
        }
        .progressOuter {
          width: 100%;
          height: 4px;
          background: #e0e0e0;
          border-radius: 2px;
          overflow: hidden;
        }
        .progressInner {
          height: 100%;
          background: #667eea;
          transition: width 0.3s;
        }
        .muted {
          color: #555;
        }
        .mutedSmall {
          color: #888;
          font-size: 14px;
        }

        .filters {
          background: white;
          padding: 25px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          margin-bottom: 20px;
          display: none;
        }
        .filters.active {
          display: block;
        }
        .filterGroup {
          margin-bottom: 20px;
        }
        .filterGroup label {
          display: block;
          font-weight: 600;
          color: #2c3e50;
          margin-bottom: 8px;
        }
        .filterGroup input {
          width: 100%;
          padding: 10px;
          border: 2px solid #e0e0e0;
          border-radius: 6px;
          font-size: 14px;
        }
        .filterGroup input:focus {
          outline: none;
          border-color: #667eea;
        }
        .filterGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 15px;
        }

        .tagFilters {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .tagFilter {
          background: #e8f4f8;
          color: #2980b9;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 13px;
          cursor: pointer;
          border: 2px solid transparent;
          transition: all 0.2s;
        }
        .tagFilter:hover {
          background: #d4e9f2;
        }
        .tagFilter.active {
          background: #667eea;
          color: white;
          border-color: #5568d3;
        }

        .stats {
          background: white;
          padding: 15px 25px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          margin-bottom: 20px;
          display: none;
        }
        .stats.active {
          display: block;
        }
        .statsContent {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 15px;
        }
        .statItem {
          font-size: 14px;
          color: #555;
        }
        .statItem strong {
          color: #667eea;
          font-size: 18px;
        }

        .postsGrid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
        }
        .postCard {
          text-align: left;
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          overflow: hidden;
          transition: transform 0.2s, box-shadow 0.2s;
          cursor: pointer;
          border: none;
          padding: 0;
        }
        .postCard:hover {
          transform: translateY(-5px);
          box-shadow: 0 8px 12px rgba(0, 0, 0, 0.15);
        }
        .postHeader {
          padding: 20px;
          border-bottom: 2px solid #f0f0f0;
        }
        .postTitle {
          font-size: 18px;
          font-weight: 600;
          color: #2c3e50;
          margin-bottom: 8px;
          line-height: 1.4;
        }
        .postAuthor {
          color: #7f8c8d;
          font-size: 14px;
          margin-bottom: 5px;
        }
        .postDate {
          color: #95a5a6;
          font-size: 12px;
        }
        .postBody {
          padding: 20px;
          max-height: 150px;
          overflow: hidden;
          color: #555;
          font-size: 14px;
          line-height: 1.6;
        }
        .postTags {
          padding: 15px 20px;
          background: #f8f9fa;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .tag {
          background: #e8f4f8;
          color: #2980b9;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
        }
        .tag.model {
          background: #fff5e6;
          color: #f39c12;
        }
        .tag.topic {
          background: #e8f8e8;
          color: #27ae60;
        }

        .noResults {
          text-align: center;
          padding: 60px 20px;
          color: white;
          font-size: 18px;
        }

        .clearFilters {
          background: #e74c3c;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          margin-top: 15px;
        }
        .clearFilters:hover {
          background: #c0392b;
        }

        .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          z-index: 1000;
          overflow-y: auto;
        }
        .modal.active {
          display: flex;
          justify-content: center;
          align-items: start;
          padding: 40px 20px;
        }
        .modalContent {
          background: white;
          border-radius: 12px;
          max-width: 1000px;
          width: 100%;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
          position: relative;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
        }
        .modalHeader {
          padding: 30px;
          border-bottom: 2px solid #f0f0f0;
        }
        .modalTitle {
          font-size: 24px;
          font-weight: 700;
          color: #2c3e50;
          margin-bottom: 10px;
        }
        .modalBody {
          padding: 30px;
          overflow-y: auto;
          line-height: 1.8;
          flex: 1;
        }
        .modalBody p {
          margin-bottom: 15px;
        }
        .modalBody img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          margin: 20px 0;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          display: block;
        }
        .modalBody iframe {
          width: 100%;
          height: 800px;
          border: 2px solid #ddd;
          border-radius: 8px;
          margin: 20px 0;
        }
        .closeBtn {
          position: absolute;
          top: 20px;
          right: 20px;
          background: #e74c3c;
          color: white;
          border: none;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 20px;
          font-weight: bold;
          z-index: 10;
        }
        .closeBtn:hover {
          background: #c0392b;
        }

        .linkBox {
          background: #e8f4f8;
          border-left: 4px solid #3498db;
          padding: 15px;
          margin: 15px 0;
          border-radius: 4px;
        }
        .linkBox a {
          color: #2980b9;
          text-decoration: none;
          font-weight: 500;
          word-break: break-all;
        }
        .linkBox a:hover {
          text-decoration: underline;
        }

        .pdfEmbed {
          margin: 20px 0;
          padding: 15px;
          background: #fff5e6;
          border-radius: 8px;
          border-left: 4px solid #f39c12;
        }
        .pdfEmbed h4 {
          color: #2c3e50;
          margin-bottom: 10px;
        }
      `}</style>
    </div>
  );
}
