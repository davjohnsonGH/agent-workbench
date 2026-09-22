import { getProjectDetail } from "@repo/workflow";

import { getDb, handle, parseId } from "@/lib/server";

export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    return getProjectDetail(getDb(), parseId(id));
  });
}
