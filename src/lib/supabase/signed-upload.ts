/** An upload to a signed Storage address. The Supabase client (about 260 KB) is loaded here, on the press, not with the screen (bloat review step 0.9). */
type Bucket = ReturnType<ReturnType<typeof import("./client").createClient>["storage"]["from"]>;
type UploadArgs = Parameters<Bucket["uploadToSignedUrl"]>;

export async function uploadToSignedUrl(bucket: string, path: UploadArgs[0], token: UploadArgs[1], file: UploadArgs[2], options?: UploadArgs[3]) {
  const { createClient } = await import("./client");
  return createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, options);
}
