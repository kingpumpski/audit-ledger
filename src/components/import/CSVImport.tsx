import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileSpreadsheet, Loader2, CheckCircle, AlertCircle, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/error-message';

interface CSVImportProps {
  entityType: 'products' | 'customers';
  onImport: (data: Record<string, string>[]) => Promise<{ success: number; failed: number }>;
  sampleData: Record<string, string>[];
  requiredFields: string[];
  optionalFields?: string[];
}

export function CSVImport({
  entityType, 
  onImport, 
  sampleData, 
  requiredFields,
  optionalFields = []
}: CSVImportProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [parsedData, setParsedData] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [step, setStep] = useState<'upload' | 'preview' | 'complete'>('upload');

  const parseCSV = (text: string): { headers: string[]; rows: Record<string, string>[] } => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have headers and at least one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      if (values.length === headers.length) {
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx];
        });
        rows.push(row);
      }
    }

    return { headers, rows };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file type
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast({ 
        title: 'Invalid file type', 
        description: 'Please upload a CSV or Excel file',
        variant: 'destructive'
      });
      return;
    }

    try {
      const text = await file.text();
      const { headers: parsedHeaders, rows } = parseCSV(text);

      // Validate required fields
      const missingFields = requiredFields.filter(f => !parsedHeaders.includes(f.toLowerCase()));
      if (missingFields.length > 0) {
        setErrors([`Missing required columns: ${missingFields.join(', ')}`]);
      } else {
        setErrors([]);
      }

      setHeaders(parsedHeaders);
      setParsedData(rows);
      setStep('preview');
    } catch (error: unknown) {
      toast({
        title: 'Failed to parse file',
        description: getErrorMessage(error, 'Unable to read the selected file.'),
        variant: 'destructive'
      });
    }
  };

  const handleImport = async () => {
    if (errors.length > 0) {
      toast({ 
        title: 'Cannot import', 
        description: 'Please fix errors first',
        variant: 'destructive'
      });
      return;
    }

    setIsImporting(true);

    try {
      const result = await onImport(parsedData);
      
      toast({
        title: `Import complete`,
        description: `${result.success} ${entityType} imported successfully${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
        variant: result.failed > 0 ? 'destructive' : 'default'
      });

      setStep('complete');
    } catch (error: unknown) {
      toast({
        title: 'Import failed',
        description: getErrorMessage(error, 'An unexpected error occurred.'),
        variant: 'destructive'
      });
    } finally {
      setIsImporting(false);
    }
  };

  const downloadSampleCSV = () => {
    const allFields = [...requiredFields, ...optionalFields];
    const headerRow = allFields.join(',');
    const dataRows = sampleData.map(row => 
      allFields.map(field => row[field] || '').join(',')
    );
    const csv = [headerRow, ...dataRows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sample_${entityType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetImport = () => {
    setParsedData([]);
    setHeaders([]);
    setErrors([]);
    setStep('upload');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) resetImport();
    }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import {entityType === 'products' ? 'Products' : 'Customers'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import {entityType === 'products' ? 'Products' : 'Customers'}
          </DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file to bulk import {entityType}.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-6 py-4">
            <Card className="border-dashed border-2">
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <Upload className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Drag and drop your file here</p>
                    <p className="text-sm text-muted-foreground">or click to browse</p>
                  </div>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileUpload}
                    className="max-w-xs mx-auto cursor-pointer"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Required Fields</h4>
                <Button variant="outline" size="sm" onClick={downloadSampleCSV}>
                  <Download className="mr-2 h-4 w-4" />
                  Download Sample
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {requiredFields.map(field => (
                  <Badge key={field} variant="default">{field}</Badge>
                ))}
                {optionalFields.map(field => (
                  <Badge key={field} variant="secondary">{field} (optional)</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="flex-1 overflow-hidden flex flex-col space-y-4">
            {errors.length > 0 && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-lg flex items-start gap-2">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <div>
                  {errors.map((error, i) => (
                    <p key={i}>{error}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {parsedData.length} records found
              </p>
              <Button variant="ghost" size="sm" onClick={resetImport}>
                Upload different file
              </Button>
            </div>

            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.slice(0, 6).map(header => (
                      <TableHead key={header} className="capitalize">{header}</TableHead>
                    ))}
                    {headers.length > 6 && <TableHead>...</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedData.slice(0, 10).map((row, i) => (
                    <TableRow key={i}>
                      {headers.slice(0, 6).map(header => (
                        <TableCell key={header} className="truncate max-w-[150px]">
                          {row[header]}
                        </TableCell>
                      ))}
                      {headers.length > 6 && <TableCell>...</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {parsedData.length > 10 && (
                <p className="text-center text-sm text-muted-foreground py-2">
                  Showing 10 of {parsedData.length} records
                </p>
              )}
            </ScrollArea>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={isImporting || errors.length > 0}>
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Import {parsedData.length} Records
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Import Complete!</h3>
              <p className="text-muted-foreground">
                Your {entityType} have been imported successfully.
              </p>
            </div>
            <Button onClick={() => setIsOpen(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
