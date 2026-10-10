import { handle } from "@/lib/server/http";
import { importPackage } from "@/lib/server/package";
import { createProject, HttpError, listProjects } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => ({ projects: await listProjects() }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const type = request.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("package");
      if (!(file instanceof File)) throw new HttpError(400, "Attach a Studio package zip.");
      return { project: await importPackage(Buffer.from(await file.arrayBuffer())) };
    }
    const body = (await request.json()) as { name?: string };
    return { project: await createProject(String(body.name ?? "Untitled film").slice(0, 80)) };
  });
}
