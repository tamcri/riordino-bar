import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BUCKET = "reorder-results";

export async function uploadResult(path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true });

  if (error) throw new Error(error.message);
}

export async function downloadResult(path: string) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error) throw new Error(error.message);

  return new Uint8Array(await data.arrayBuffer());
}

