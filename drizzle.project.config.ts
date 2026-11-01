import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/server/project/schema.ts",
  out: "./drizzle/project",
  dialect: "sqlite",
  dbCredentials: {
    url: "./notebook.db",
  },
});
