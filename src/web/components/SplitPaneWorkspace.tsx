import React from "react";
import * as Resizable from "react-resizable-panels";

interface SplitPaneWorkspaceProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLayout?: number[];
}

export function SplitPaneWorkspace({
  left,
  right,
  defaultLayout = [30, 70],
}: SplitPaneWorkspaceProps) {
  // In version 4.10.0, the components are named Group, Panel, Separator

  return (
    <Resizable.Group orientation="horizontal" className="flex-1 w-full h-full min-h-0 bg-slate-950">
      <Resizable.Panel
        defaultSize={defaultLayout[0]}
        minSize={20}
        className="flex flex-col border-r border-slate-800"
      >
        <div className="flex-1 overflow-auto bg-slate-900/50">{left}</div>
      </Resizable.Panel>

      <Resizable.Separator className="w-1.5 hover:bg-blue-600/50 transition-colors bg-transparent relative group">
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-slate-800 group-hover:bg-blue-400/50" />
      </Resizable.Separator>

      <Resizable.Panel
        defaultSize={defaultLayout[1]}
        minSize={30}
        className="flex flex-col bg-slate-950"
      >
        <div className="flex-1 overflow-auto p-6">{right}</div>
      </Resizable.Panel>
    </Resizable.Group>
  );
}
