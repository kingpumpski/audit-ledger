import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { ChartOfAccounts } from '@/components/accounting/ChartOfAccounts';
import {
  BookOpen, BookText, Scale, CalendarRange, ArrowDownToLine, ArrowUpFromLine,
  Wallet, Layers, Building2, BarChart3, GitMerge, ShieldCheck,
} from 'lucide-react';

const ComingSoon = ({ title, description }: { title: string; description: string }) => (
  <Card className="p-10 text-center">
    <h3 className="text-lg font-semibold mb-2">{title}</h3>
    <p className="text-sm text-muted-foreground max-w-xl mx-auto">{description}</p>
    <p className="text-xs text-muted-foreground mt-4">Coming soon.</p>
  </Card>
);

const tabs = [
  { value: 'coa',         label: 'Chart of Accounts', icon: BookOpen },
  { value: 'journal',     label: 'Journal Entries',   icon: BookText },
  { value: 'trial',       label: 'Trial Balance',     icon: Scale },
  { value: 'periods',     label: 'Fiscal Periods',    icon: CalendarRange },
  { value: 'ar',          label: 'Accounts Receivable', icon: ArrowDownToLine },
  { value: 'ap',          label: 'Accounts Payable',  icon: ArrowUpFromLine },
  { value: 'cash',        label: 'Cash & Bank',       icon: Wallet },
  { value: 'cost',        label: 'Cost Centers & Budget', icon: Layers },
  { value: 'assets',      label: 'Fixed Assets',      icon: Building2 },
  { value: 'reports',     label: 'Financial Reports', icon: BarChart3 },
  { value: 'consolidation', label: 'AI & Consolidation', icon: GitMerge },
  { value: 'recon',       label: 'Reconciliation & Audit', icon: ShieldCheck },
];

export default function Accounting() {
  return (
    <AppLayout title="Accounting" subtitle="Chart of accounts, journals, and financial reports">
      <Tabs defaultValue="coa" className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="flex flex-wrap h-auto justify-start gap-1 p-1">
            {tabs.map(t => (
              <TabsTrigger key={t.value} value={t.value} className="gap-2">
                <t.icon className="h-4 w-4" />
                <span>{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="coa"><ChartOfAccounts /></TabsContent>
        <TabsContent value="journal">
          <ComingSoon title="Journal Entries" description="Record double-entry journal transactions with debits and credits posted against the chart of accounts." />
        </TabsContent>
        <TabsContent value="trial">
          <ComingSoon title="Trial Balance" description="Auto-computed trial balance summarising debits and credits across all accounts for a selected period." />
        </TabsContent>
        <TabsContent value="periods">
          <ComingSoon title="Fiscal Periods" description="Define and close monthly, quarterly, and annual fiscal periods to lock historical records." />
        </TabsContent>
        <TabsContent value="ar">
          <ComingSoon title="Accounts Receivable" description="Aging reports, customer balances, and collection tracking derived from issued invoices." />
        </TabsContent>
        <TabsContent value="ap">
          <ComingSoon title="Accounts Payable" description="Vendor bills, payment scheduling, and AP aging reports." />
        </TabsContent>
        <TabsContent value="cash">
          <ComingSoon title="Cash & Bank" description="Bank account registers, cash positions, and cashbook entries." />
        </TabsContent>
        <TabsContent value="cost">
          <ComingSoon title="Cost Centers & Budget" description="Define cost centers, allocate expenses, and track budget vs actuals." />
        </TabsContent>
        <TabsContent value="assets">
          <ComingSoon title="Fixed Assets" description="Asset register with depreciation schedules and disposal tracking." />
        </TabsContent>
        <TabsContent value="reports">
          <ComingSoon title="Financial Reports" description="Income Statement, Balance Sheet, Cash Flow, and exportable management reports." />
        </TabsContent>
        <TabsContent value="consolidation">
          <ComingSoon title="AI & Consolidation" description="AI-assisted entity consolidation, anomaly detection, and forecasting." />
        </TabsContent>
        <TabsContent value="recon">
          <ComingSoon title="Reconciliation & Audit" description="Bank reconciliation, intercompany matching, and audit trail review." />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}