"use client";

import { useState } from "react";
import type { IntelEvidencePost } from "@/lib/marketer/types";

export type IntelEvidenceModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  posts: IntelEvidencePost[];
  onClose: () => void;
};

export function IntelEvidenceModal({ open, title, subtitle, posts, onClose }: IntelEvidenceModalProps) {
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());

  if (!open) return null;

  return (
    <div className="intel-evidence-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="intel-evidence-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intel-evidence-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="intel-evidence-modal-header">
          <div>
            <h3 id="intel-evidence-modal-title">{title}</h3>
            {subtitle ? <p className="intel-evidence-modal-sub">{subtitle}</p> : null}
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <div className="intel-evidence-modal-body">
          {posts.length === 0 ? (
            <p className="workspace-muted">No matching posts found in this research brief.</p>
          ) : (
            <ul className="intel-evidence-post-list">
              {posts.map((post) => (
                <li key={post.insightsId} className="intel-evidence-post">
                  <div className="intel-evidence-post-thumb">
                    {post.thumbnailUrl && !brokenThumbs.has(post.insightsId) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setBrokenThumbs((prev) => {
                            const next = new Set(prev);
                            next.add(post.insightsId);
                            return next;
                          })
                        }
                      />
                    ) : (
                      <span>{post.format.slice(0, 1)}</span>
                    )}
                  </div>
                  <div className="intel-evidence-post-body">
                    <h4>{post.title}</h4>
                    <p className="intel-evidence-post-meta">
                      {post.platform}
                      {post.format ? ` · ${post.format}` : ""}
                      {post.primaryEmotion ? ` · ${post.primaryEmotion}` : ""}
                    </p>
                    {post.customLabel1 ? (
                      <p className="intel-evidence-post-tag">{post.customLabel1}</p>
                    ) : null}
                    {post.postUrl ? (
                      <a
                        href={post.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="intel-evidence-link"
                      >
                        View post →
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
