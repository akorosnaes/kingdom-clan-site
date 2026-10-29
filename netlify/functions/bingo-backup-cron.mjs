// Scheduled: backs up the bingo every 6 hours (00:00, 06:00, 12:00 and 18:00 UTC). Staff see and restore them in the staff console.
import { makeBackup } from "../lib/backup.mjs";

export default async () => {
  const b = await makeBackup("auto", "Every 6 hours");
  console.log("Bingo backup", b.id, b.size, "bytes");
};

export const config = { schedule: "0 */6 * * *" };
