import { api, type GraphData, type GraphifyInfo } from "@/lib/api";
import { ApiOffline } from "@/components/api-offline";
import { GraphExplorer } from "./graph-explorer";

export default async function GraphPage() {
  let data: GraphData;
  let graphify: GraphifyInfo;
  try {
    [data, graphify] = await Promise.all([
      api.graph(),
      api.graphify().catch(() => ({ available: false, communities: {} })),
    ]);
  } catch {
    return <ApiOffline />;
  }
  return <GraphExplorer initialData={data} initialGraphify={graphify} />;
}
