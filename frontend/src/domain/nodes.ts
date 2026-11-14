import type {
  ContentKind,
  ContentStatus,
  RelationshipKind,
  RelationshipMethod,
  RelationshipStatus,
  SourceNode,
} from "../contracts/newsTrace";

/**
 * The shared contract includes `title`. Read it defensively so older fixture
 * payloads without a title still fall back to the canonical URL.
 */
export interface NodeTitleDisplay {
  text: string;
  isUrlFallback: boolean;
}

export function readNodeTitle(node: SourceNode): string | null {
  const title = node.title;
  return typeof title === "string" && title.trim().length > 0
    ? title.trim()
    : null;
}

export function displayNodeTitle(node: SourceNode): NodeTitleDisplay {
  const title = readNodeTitle(node);
  if (title) {
    return { text: title, isUrlFallback: false };
  }

  return {
    text: node.canonical_url || node.requested_url || node.id,
    isUrlFallback: true,
  };
}

export function sourceName(node: SourceNode): string {
  const name = node.source.name?.trim();
  return name && name.length > 0 ? name : node.source.domain;
}

export function sourceIdentity(node: SourceNode): string {
  const name = node.source.name?.trim();
  if (name && name.length > 0 && name !== node.source.domain) {
    return `${name} · ${node.source.domain}`;
  }
  return node.source.domain;
}

export function contentKindLabel(kind: ContentKind): string {
  switch (kind) {
    case "post":
      return "Post";
    case "news":
      return "News";
    case "webpage":
      return "Web page";
  }
}

export function contentStatusLabel(status: ContentStatus): string {
  switch (status) {
    case "full_text":
      return "Full text";
    case "excerpt":
      return "Excerpt";
    case "snippet_only":
      return "Search snippet only";
    case "unavailable":
      return "Unavailable";
  }
}

export function relationshipKindLabel(kind: RelationshipKind): string {
  switch (kind) {
    case "links_to":
      return "Links to";
    case "references":
      return "References";
    case "replies_to":
      return "Replies to";
    case "reposts":
      return "Reposts";
    case "same_event":
      return "Same event";
    case "follows_up":
      return "Follows up";
    case "related_topic":
      return "Related topic";
  }
}

export function relationshipMethodLabel(
  method: RelationshipMethod,
): string {
  switch (method) {
    case "source_link":
      return "Source link";
    case "platform_metadata":
      return "Platform metadata";
    case "llm_inference":
      return "Inferred";
  }
}

export function relationshipStatusLabel(
  status: RelationshipStatus,
): string {
  return status === "validated" ? "Validated" : "Provisional";
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}
