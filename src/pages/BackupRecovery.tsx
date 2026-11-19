import { AppLayout } from '@/components/layout/AppLayout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Archive, Cloud, Database, FileCheck2, HardDrive, ShieldCheck, Users } from 'lucide-react';

const components = [
  {
    title: 'Database',
    description: 'Consistent PostgreSQL schema, data, roles, grants, functions, policies and migration history.',
    icon: Database,
  },
  {
    title: 'Authentication',
    description: 'Auth users and the recoverable identity, password and MFA configuration proven by restore tests.',
    icon: Users,
  },
  {
    title: 'Storage',
    description: 'Private and public bucket configuration, object metadata and the actual uploaded file contents.',
    icon: HardDrive,
  },
  {
    title: 'Project configuration',
    description: 'Extensions, Edge Function source commit, required settings and a secure secrets recovery inventory.',
    icon: Cloud,
  },
];

export default function BackupRecovery() {
  return (
    <AppLayout title="Backup & Recovery">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Backup & Recovery</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Project-level disaster recovery for database, authentication, files and configuration.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">Setup required</Badge>
        </div>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Automated backup service is not configured</AlertTitle>
          <AlertDescription>
            No backup provider or worker is connected yet. This page does not create backups and no recovery point is currently being represented as available or verified. Production migrations remain blocked until a complete backup has been restored and verified in an isolated environment.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          {components.map(({ title, description, icon: Icon }) => (
            <Card key={title}>
              <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                <div className="rounded-lg bg-muted p-2"><Icon className="h-5 w-5" aria-hidden="true" /></div>
                <div className="space-y-1">
                  <CardTitle className="text-base">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Archive className="h-5 w-5" /> Recovery package requirements</CardTitle>
            <CardDescription>
              A package is not considered complete until all required components have been exported, checksummed and restored successfully in an isolated project.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2 text-sm"><FileCheck2 className="mt-0.5 h-4 w-4 text-muted-foreground" /> Manifest, source commit and migration-history fingerprint</div>
            <div className="flex items-start gap-2 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 text-muted-foreground" /> Encryption, integrity checks and independent storage</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Release safety</CardTitle>
            <CardDescription>
              The migration safety gate must validate the backup server-side. A browser status, manual checkbox or database-only export is not sufficient.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>1. Generate a project-level backup outside the production project.</p>
            <p>2. Verify database, Auth, Storage and configuration exports.</p>
            <p>3. Restore the package into an isolated Supabase project.</p>
            <p>4. Run tenant-isolation, accounting and inventory integrity checks.</p>
            <p>5. Only then mark the artifact verified and allow the separate migration release review to proceed.</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
