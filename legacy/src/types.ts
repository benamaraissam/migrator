export interface ColumnDef {
  name: string;
  data_type: string;
  nullable: boolean;
  sample_values?: string[];
  description?: string;
}

export interface Schema {
  table_name: string;
  columns: ColumnDef[];
}

export interface MappingItem {
  target_column: string;
  source_columns: string[];
  confidence_score: number;
  match_type: "exact" | "semantic" | "transformed" | "derived" | "incompatible";
  reasoning: string;
  transformation_rule: string | null;
}

export interface MappingResult {
  mappings: MappingItem[];
  unmapped_source_columns: string[];
  unmapped_target_columns: string[];
  global_confidence: number;
  analysis_summary: string;
}
