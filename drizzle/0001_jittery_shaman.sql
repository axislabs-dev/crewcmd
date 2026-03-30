-- Add images column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tasks' AND column_name = 'images'
  ) THEN
    ALTER TABLE "tasks" ADD COLUMN "images" jsonb DEFAULT '[]'::jsonb NOT NULL;
  END IF;
END $$;