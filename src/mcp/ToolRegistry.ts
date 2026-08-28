import { readFileSync } from 'node:fs';
import { ToolInput, ToolResult } from '../types';

// ---------------------------------------------------------------------------
// Tool handler contract
// ---------------------------------------------------------------------------

/**
 * A ToolHandler is any callable that accepts a ToolInput and returns
 * a Promise<ToolResult>.  Implementations live in the MCP adapter layer
 * and are registered with the ToolRegistry.
 */
export type ToolHandler = (input: ToolInput) => Promise<ToolResult>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`MCP tool "${toolName}" is not registered`);
    this.name = 'ToolNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * ToolRegistry is the single in-process catalogue of available MCP tools.
 *
 * Tools are registered by name and invoked through ToolInvoker, which adds
 * timeout, error-handling, and observability concerns on top of this registry.
 */
export interface ToolCatalogEntry {
  name: string;
  server: string;
  capabilities?: string[];
  description?: string;
  category?: string;
  status?: string;
}

export interface ToolSelection {
  tools: ToolCatalogEntry[];
  servers: string[];
}

export const CANONICAL_TOOL_MAP = {
  google_search: 'web_search',
  maps: 'maps_search_places',
  business_directory_search: 'company_directory_search',
  public_records_search: 'public_records_search',
  marketplace_search: 'marketplace_search',
  website_research: 'website_content_research',
  technology_detection: 'detect_technologies',
  competitive_intelligence_search: 'competitive_intelligence_search',
  events_search: 'events_search',
  signal_monitoring: 'signal_monitoring',
  company_enrichment: 'enrich_company',
  person_enrichment: 'enrich_person',
  yellow_pages_business_lookup: 'yellow_pages_business_lookup',
  yellow_pages_person_lookup: 'yellow_pages_person_lookup',
  yellow_pages_business: 'yellow_pages_business_lookup',
  yellow_pages_person: 'yellow_pages_person_lookup',
  directory_contact_fallback: 'yellow_pages_business_lookup',
  person_contact_lookup: 'yellow_pages_person_lookup',
  lead_scoring: 'lead_scoring',
} as const;

export function loadToolkitCatalogFromFile(filePath: string): ToolCatalogEntry[] {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as { tools?: ToolCatalogEntry[] };
  return Array.isArray(parsed.tools) ? parsed.tools : [];
}

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  private static canonicalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private static readonly logicalToolAliases: Record<string, string[]> = {
    google_search: ['web_search'],
    maps: ['maps_search_places'],
    business_directory_search: ['company_directory_search'],
    public_records_search: ['public_records_search'],
    marketplace_search: ['marketplace_search'],
    website_research: ['website_content_research', 'website_technology_scan'],
    technology_detection: ['detect_technologies'],
    competitive_intelligence_search: ['competitive_intelligence_search'],
    events_search: ['events_search'],
    signal_monitoring: ['signal_monitoring'],
    company_enrichment: ['enrich_company'],
    person_enrichment: ['enrich_person'],
    yellow_pages_business_lookup: ['yellow_pages_business_lookup', 'yellow_pages_business'],
    yellow_pages_person_lookup: ['yellow_pages_person_lookup', 'yellow_pages_person'],
    yellow_pages_business: ['yellow_pages_business_lookup'],
    yellow_pages_person: ['yellow_pages_person_lookup'],
    directory_contact_fallback: ['yellow_pages_business_lookup'],
    person_contact_lookup: ['yellow_pages_person_lookup'],
  };

  /** Register (or replace) a tool handler. */
  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  /** Retrieve a handler by name. */
  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  /** Returns all registered tool names. */
  listTools(): string[] {
    return Array.from(this.handlers.keys());
  }

  /** Returns true if the named tool is registered. */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Select tools from a toolkit catalog using the runtime’s required tool IDs.
   * This allows a runtime to load only the required server(s) and not a monolithic
   * tool bundle for every capability.
   */
  selectByCatalog(
    catalog: ToolCatalogEntry[],
    requiredToolNames: string[],
  ): ToolSelection {
    const requiredNames = this.resolveRequiredToolNames(catalog, requiredToolNames);
    const selectedTools = catalog.filter((tool) => requiredNames.has(tool.name));
    const servers = Array.from(new Set(selectedTools.map((tool) => tool.server))).sort();

    return {
      tools: selectedTools,
      servers,
    };
  }

  /**
   * Resolve logical declaration IDs and canonical capability names into the concrete
   * toolkit tool names that are actually registered in the catalog.
   */
  resolveRequiredToolNames(
    catalog: ToolCatalogEntry[],
    requiredToolNames: string[],
  ): Set<string> {
    const directMatches = new Set<string>();
    const exactToolNames = new Map<string, string>();

    for (const entry of catalog) {
      exactToolNames.set(ToolRegistry.canonicalize(entry.name), entry.name);
    }

    for (const required of requiredToolNames) {
      const exactName = exactToolNames.get(ToolRegistry.canonicalize(required));
      if (exactName) {
        directMatches.add(exactName);
        continue;
      }

      const canonical = CANONICAL_TOOL_MAP[required as keyof typeof CANONICAL_TOOL_MAP];
      if (canonical) {
        const mappedName = exactToolNames.get(ToolRegistry.canonicalize(canonical));
        if (mappedName) {
          directMatches.add(mappedName);
          continue;
        }
      }

      const aliasCandidates = ToolRegistry.logicalToolAliases[required]
        ?? ToolRegistry.logicalToolAliases[required.replace(/[-_]+/g, '_')]
        ?? [];

      for (const alias of aliasCandidates) {
        const aliasName = exactToolNames.get(ToolRegistry.canonicalize(alias));
        if (aliasName) {
          directMatches.add(aliasName);
          break;
        }
      }
    }

    return directMatches;
  }
}
