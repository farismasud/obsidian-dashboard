import { api, type GraphData } from "@/lib/api";
import { GraphView } from "./graph-view";

export default async function GraphPage() {
  let data: GraphData = { nodes: [], links: [] };

  try {
    data = await api.graph();
  } catch {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-sm">Cannot connect to API</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 h-14 flex items-center border-b border-border/50 shrink-0">
        <h1 className="text-sm font-semibold">Graph View</h1>
        <span className="ml-2 text-xs text-muted-foreground">
          {data.nodes.length} nodes · {data.links.length} links
        </span>
      </div>
      <div className="flex-1">
        <GraphView data={data} />
      </div>
    </div>
  );
}
