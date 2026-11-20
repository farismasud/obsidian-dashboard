export function ApiOffline() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="surface animate-enter max-w-sm p-6 text-center">
        <p className="text-sm font-medium">Vault API is offline</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Check the <code className="font-mono text-primary">obsidian-api</code> service on the server.
        </p>
      </div>
    </div>
  );
}
