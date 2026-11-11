import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { SignaturePad } from '@/components/SignaturePad';
import { MfaSettingsCard } from '@/components/auth/MfaSettingsCard';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, User, Pen, Save } from 'lucide-react';

export default function Profile() {
  const { profile, isLoading, updateProfile, updateSignature, isUpdating, isUpdatingSignature } = useProfile();
  const { roles } = useAuth();
  
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    job_title: '',
    department: '',
  });
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);

  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        phone: profile.phone || '',
        job_title: profile.job_title || '',
        department: profile.department || '',
      });
      setSignatureData(profile.signature_data);
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile(formData);
  };

  const handleSignatureSave = async (data: string) => {
    setSignatureData(data);
    await updateSignature(data);
    setShowSignaturePad(false);
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-accent text-accent-foreground';
      case 'accountant': return 'bg-primary text-primary-foreground';
      case 'auditor': return 'bg-warning text-warning-foreground';
      case 'cashier': return 'bg-success text-success-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  if (isLoading) {
    return (
      <AppLayout title="Profile" subtitle="Manage your profile settings">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Profile" subtitle="Manage your personal information and signature">
      <div className="grid gap-6 max-w-4xl">
        {/* Profile Info Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-primary/20">
                <AvatarImage src={profile?.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-xl">
                  {getInitials(profile?.full_name || 'U')}
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl">{profile?.full_name || 'User'}</CardTitle>
                <CardDescription>{profile?.email}</CardDescription>
                <div className="flex gap-1.5 mt-2">
                  {roles.map((role) => (
                    <span
                      key={role}
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize ${getRoleBadgeColor(role)}`}
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="full_name">Full Name</Label>
                  <Input
                    id="full_name"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="Enter your full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+1 555-0000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="job_title">Job Title</Label>
                  <Input
                    id="job_title"
                    value={formData.job_title}
                    onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
                    placeholder="e.g. Senior Accountant"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Input
                    id="department"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    placeholder="e.g. Finance"
                  />
                </div>
              </div>
              <Button type="submit" disabled={isUpdating}>
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Digital Signature Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Pen className="h-5 w-5" />
              Digital Signature
            </CardTitle>
            <CardDescription>
              Your digital signature will be used when issuing receipts. Draw your signature to save it for future use.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {showSignaturePad ? (
              <div className="space-y-4">
                <SignaturePad
                  onSave={handleSignatureSave}
                  onClear={() => setSignatureData(null)}
                  signerName={profile?.full_name || 'User'}
                  initialData={signatureData || undefined}
                />
                <Button variant="outline" onClick={() => setShowSignaturePad(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {signatureData ? (
                  <div className="space-y-3">
                    <div className="border rounded-lg p-4 bg-card">
                      <p className="text-xs text-muted-foreground mb-2">Current Signature:</p>
                      <img 
                        src={signatureData} 
                        alt="Your signature" 
                        className="max-h-24 mx-auto"
                      />
                      <p className="text-center text-sm text-muted-foreground mt-2">
                        {profile?.full_name}
                      </p>
                    </div>
                    <Button 
                      variant="outline" 
                      onClick={() => setShowSignaturePad(true)}
                      disabled={isUpdatingSignature}
                    >
                      <Pen className="mr-2 h-4 w-4" />
                      Update Signature
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-8 border-2 border-dashed rounded-lg">
                    <User className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-muted-foreground mb-4">No signature saved yet</p>
                    <Button onClick={() => setShowSignaturePad(true)}>
                      <Pen className="mr-2 h-4 w-4" />
                      Create Signature
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <MfaSettingsCard />
      </div>
    </AppLayout>
  );
}
