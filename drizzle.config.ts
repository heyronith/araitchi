import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.ARAITCHI_DATA_DIR
      ? `${process.env.ARAITCHI_DATA_DIR}/app.db`
      : "./app.db",
  },
});
