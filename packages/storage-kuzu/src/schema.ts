/**
 * Kùzu graph schema.
 * One generic `Node` table and one generic `Edge` table cover every ontology,
 * because the Braid ontology lives in `type` and `metadata` properties,
 * not in Kùzu's table catalogue.
 * This keeps schema migrations tied to Braid schema changes,
 * rather than to user-defined ontology edits.
 */
export const DDL_CREATE_NODE_TABLE = `
  CREATE NODE TABLE IF NOT EXISTS Node(
    id STRING,
    type STRING,
    name STRING,
    description STRING,
    status STRING,
    metadata STRING,
    embedding STRING,
    PRIMARY KEY (id)
  );
`

export const DDL_CREATE_EDGE_TABLE = `
  CREATE REL TABLE IF NOT EXISTS Edge(
    FROM Node TO Node,
    id STRING,
    type STRING,
    metadata STRING
  );
`
