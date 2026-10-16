import type { Assistant, Tag } from "@/lib/models";
import { normalizeForSearch } from "@/lib/text";

export interface AssistantFilter {
  query: string;
  /** All selected tags must be present (AND). */
  tagIds: string[];
}

export const EMPTY_FILTER: AssistantFilter = { query: "", tagIds: [] };

/** Matches by assistant name/description or by the name of any of its tags; tags combine with AND. */
export function filterAssistants(assistants: readonly Assistant[], tags: readonly Tag[], filter: AssistantFilter): Assistant[] {
  const query = normalizeForSearch(filter.query);
  const tagNames = new Map(tags.map((tag) => [tag.id, normalizeForSearch(tag.name)]));
  const required = filter.tagIds.filter((id) => tagNames.has(id));
  return assistants.filter((assistant) => {
    if (required.some((id) => !assistant.tagIds.includes(id))) return false;
    if (!query) return true;
    if (normalizeForSearch(assistant.name).includes(query)) return true;
    if (normalizeForSearch(assistant.description).includes(query)) return true;
    return assistant.tagIds.some((id) => tagNames.get(id)?.includes(query));
  });
}

const QUERY_PARAM = "q";
const TAGS_PARAM = "tags";

/** URL <-> filter. Unknown/duplicate tag ids are dropped so links stay clean. */
export function filterFromSearchParams(params: URLSearchParams, knownTagIds?: readonly string[]): AssistantFilter {
  const query = (params.get(QUERY_PARAM) ?? "").slice(0, 200);
  const raw = (params.get(TAGS_PARAM) ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const unique = [...new Set(raw)].slice(0, 20);
  return { query, tagIds: knownTagIds ? unique.filter((id) => knownTagIds.includes(id)) : unique };
}

export function filterToSearchParams(filter: AssistantFilter, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base);
  if (filter.query.trim()) params.set(QUERY_PARAM, filter.query);
  else params.delete(QUERY_PARAM);
  if (filter.tagIds.length) params.set(TAGS_PARAM, filter.tagIds.join(","));
  else params.delete(TAGS_PARAM);
  return params;
}

export function toggleTag(filter: AssistantFilter, tagId: string): AssistantFilter {
  return {
    ...filter,
    tagIds: filter.tagIds.includes(tagId) ? filter.tagIds.filter((id) => id !== tagId) : [...filter.tagIds, tagId],
  };
}
