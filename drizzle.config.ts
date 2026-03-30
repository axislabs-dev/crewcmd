import { defineConfig } from "drizzle-kit";

const isPglite = !process.env.DATABASE_URL;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(isPglite
    ? {
        driver: "pglite",
        dbCredentials: {
          url: ".data/pglite",
        },
      }
    : {
        dbCredentials: {
          url: process.env.DATABASE_URL!,
        },
      }),
});
