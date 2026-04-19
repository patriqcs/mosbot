import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const SettingsPage = (): JSX.Element => (
  <div className="flex flex-col gap-6">
    <h1 className="text-2xl font-bold">Settings</h1>
    <Card>
      <CardHeader>
        <CardTitle>Config file</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <p>
          Edit <code>/config/config.yaml</code> on the Unraid host and restart the container to
          apply changes. Hot-reload of specific fields is planned; use the log-level selector in
          the <em>Logs</em> tab for runtime log-level changes.
        </p>
      </CardContent>
    </Card>
  </div>
);
