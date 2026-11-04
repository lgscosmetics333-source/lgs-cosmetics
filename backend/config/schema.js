// Sequelize v6/MySQL can append a new column_N unique index on every alter sync.
// Preserve one equivalent index (and all custom/primary indexes) before syncing.
export async function removeGeneratedDuplicateIndexes(connection) {
  const query = connection.getQueryInterface();
  const tables = await query.showAllTables();
  const managed = new Set(Object.values(connection.models).map(model => model.getTableName()).filter(name => typeof name === "string"));
  let removed = 0;
  for (const table of tables) {
    if (typeof table !== "string" || !managed.has(table)) continue;
    const indexes = (await query.showIndex(table)).filter(index => index.unique && (index.type || "BTREE").toUpperCase() === "BTREE" && index.fields?.length === 1 && index.fields[0].attribute && index.fields[0].length == null);
    const generated = index => {
      const column = index.fields[0].attribute;
      return index.name !== "PRIMARY" && (index.name === column || (index.name.startsWith(`${column}_`) && /^\d+$/.test(index.name.slice(column.length + 1))));
    };
    const signature = index => JSON.stringify(index.fields.map(field => [field.attribute, field.collate || "A", field.order || "ASC"]));
    const seen = new Set(indexes.filter(index => !generated(index)).map(signature));
    for (const index of indexes.filter(generated)) {
      const key = signature(index);
      if (seen.has(key)) { await query.removeIndex(table, index.name); removed++; }
      else seen.add(key);
    }
  }
  return removed;
}

export async function syncDatabaseSchema(connection) {
  const removed = await removeGeneratedDuplicateIndexes(connection);
  if (removed) console.log(`Removed ${removed} redundant generated unique indexes; equivalent constraints retained.`);
  return connection.sync({ alter: true });
}
