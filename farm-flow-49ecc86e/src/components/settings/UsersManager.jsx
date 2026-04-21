import React, { useState, useEffect } from "react";
import { User, Farm } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Edit, UserCheck, UserX, Shield, AlertTriangle, UserPlus, Mail, Copy, Check, KeyRound } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";
import { localAuth } from "@/api/localClient";

export default function UsersManager() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentFarm, setCurrentFarm] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [resetPasswordUser, setResetPasswordUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [formData, setFormData] = useState({});
  const [inviteData, setInviteData] = useState({
    email: "",
    role: "viewer",
    full_name: ""
  });
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadUsers();
    loadCurrentUser();
    loadCurrentFarm();
  }, []);

  const loadUsers = async () => {
    try {
      const usersData = await User.list();
      setUsers(Array.isArray(usersData) ? usersData : []);
    } catch (error) {
      console.error("Failed to load users:", error);
      setUsers([]);
      toast({ title: "שגיאה", description: "טעינת המשתמשים נכשלה.", variant: "destructive" });
    }
  };

  const loadCurrentUser = async () => {
    try {
      const user = await User.me();
      setCurrentUser(user);
    } catch (error) {
      console.log("User not authenticated or failed to load current user:", error);
    }
  };

  const loadCurrentFarm = async () => {
    try {
      const user = await User.me();
      if (user?.current_farm_id) {
        const farm = await Farm.get(user.current_farm_id);
        setCurrentFarm(farm);
      }
    } catch (error) {
      console.log("Failed to load current farm:", error);
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      role: user.role || "viewer",
      phone: user.phone || "",
      position: user.position || "",
      department: user.department || "",
      hire_date: user.hire_date || "",
      is_active: user.is_active !== false,
      permissions: user.permissions || getDefaultPermissions(user.role || "viewer")
    });
    setIsDialogOpen(true);
  };

  const getDefaultPermissions = (role) => {
    const defaults = {
      owner: {
        can_create_seedings: true,
        can_edit_seedings: true,
        can_delete_seedings: true,
        can_manage_plots: true,
        can_manage_weighing: true,
        can_view_reports: true,
        can_manage_settings: true,
        can_manage_users: true
      },
      manager: {
        can_create_seedings: true,
        can_edit_seedings: true,
        can_delete_seedings: true,
        can_manage_plots: true,
        can_manage_weighing: true,
        can_view_reports: true,
        can_manage_settings: false,
        can_manage_users: false
      },
      worker: {
        can_create_seedings: false,
        can_edit_seedings: true,
        can_delete_seedings: false,
        can_manage_plots: false,
        can_manage_weighing: true,
        can_view_reports: true,
        can_manage_settings: false,
        can_manage_users: false
      },
      viewer: {
        can_create_seedings: false,
        can_edit_seedings: false,
        can_delete_seedings: false,
        can_manage_plots: false,
        can_manage_weighing: false,
        can_view_reports: true,
        can_manage_settings: false,
        can_manage_users: false
      }
    };
    return defaults[role] || defaults.viewer;
  };

  const handleRoleChange = (role) => {
    setFormData(prev => ({
      ...prev, 
      role,
      permissions: getDefaultPermissions(role)
    }));
  };

  const handlePermissionChange = (permission, value) => {
    setFormData(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [permission]: value
      }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await User.update(editingUser.id, formData);
      toast({ title: "הצלחה", description: "הרשאות המשתמש עודכנו." });
      setIsDialogOpen(false);
      loadUsers();
    } catch (error) {
      console.error("Failed to update user permissions:", error);
      toast({ title: "שגיאה", description: "עדכון ההרשאות נכשל.", variant: "destructive" });
    }
  };

  const handleOpenInviteDialog = () => {
    setInviteData({
      email: "",
      role: "viewer",
      full_name: ""
    });
    setInviteLink("");
    setCopied(false);
    setIsInviteDialogOpen(true);
  };

  const generateInviteLink = () => {
    if (!inviteData.email || !currentFarm) {
      toast({ title: "שגיאה", description: "נא למלא אימייל", variant: "destructive" });
      return;
    }

    // Create invite token with farm and role info
    const inviteToken = btoa(JSON.stringify({
      farm_id: currentFarm.id,
      farm_name: currentFarm.name,
      role: inviteData.role,
      invited_by: currentUser?.email,
      timestamp: new Date().toISOString()
    }));

    const baseUrl = window.location.origin;
    const link = `${baseUrl}/signup?invite=${inviteToken}&email=${encodeURIComponent(inviteData.email)}`;
    
    setInviteLink(link);
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({ title: "הועתק!", description: "הלינק הועתק ללוח" });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({ title: "שגיאה", description: "לא ניתן להעתיק", variant: "destructive" });
    }
  };

  const sendInviteEmail = async () => {
    if (!inviteData.email || !inviteLink) {
      toast({ title: "שגיאה", description: "נא ליצור לינק תחילה", variant: "destructive" });
      return;
    }

    setIsSendingInvite(true);
    
    try {
      await base44.integrations.Core.SendEmail({
        to: inviteData.email,
        from_name: currentFarm?.name || "FarmFlow",
        subject: `הוזמנת להצטרף למשק ${currentFarm?.name || ''}`,
        body: `
שלום ${inviteData.full_name || ''},

הוזמנת על ידי ${currentUser?.full_name} להצטרף למשק "${currentFarm?.name}" במערכת FarmFlow.

התפקיד שלך במערכת: ${getRoleLabel(inviteData.role)}

להצטרפות למשק, לחץ על הלינק הבא:
${inviteLink}

הלינק תקף ל-7 ימים.

בברכה,
צוות FarmFlow
        `
      });

      toast({ 
        title: "הצלחה!", 
        description: "מייל ההזמנה נשלח בהצלחה" 
      });
      
      setIsInviteDialogOpen(false);
      
    } catch (error) {
      console.error("Failed to send invite email:", error);
      toast({ 
        title: "שגיאה בשליחת מייל", 
        description: "ניתן להעתיק את הלינק ולשלוח אותו באופן ידני",
        variant: "destructive" 
      });
    } finally {
      setIsSendingInvite(false);
    }
  };

  const getRoleBadge = (role) => {
    const variants = {
      owner: "default",
      manager: "secondary", 
      worker: "outline",
      viewer: "secondary"
    };
    const labels = {
      owner: "בעלים",
      manager: "מנהל",
      worker: "עובד", 
      viewer: "צופה"
    };
    return <Badge variant={variants[role]}>{labels[role] || role}</Badge>;
  };

  const getRoleLabel = (role) => {
    const labels = {
      owner: "בעלים",
      manager: "מנהל",
      worker: "עובד", 
      viewer: "צופה"
    };
    return labels[role] || role;
  };

  const canEditUser = (user) => {
    if (!currentUser) return false;
    if (currentUser.role !== "owner" && currentUser.role !== "manager") return false;
    if (currentUser.role === "manager" && user.role === "owner") return false;
    return true;
  };

  const permissionLabels = {
    can_create_seedings: "יצירת מזרעים",
    can_edit_seedings: "עריכת מזרעים", 
    can_delete_seedings: "מחיקת מזרעים",
    can_manage_plots: "ניהול חלקות",
    can_manage_weighing: "ניהול שקילות",
    can_view_reports: "צפייה בדוחות",
    can_manage_settings: "ניהול הגדרות",
    can_manage_users: "ניהול משתמשים"
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast({ title: "שגיאה", description: "סיסמה חייבת להיות לפחות 6 תווים", variant: "destructive" });
      return;
    }
    setIsResetting(true);
    try {
      await localAuth.adminResetPassword(resetPasswordUser.id, newPassword);
      toast({ title: "הצלחה", description: `סיסמת ${resetPasswordUser.full_name || resetPasswordUser.email} אופסה` });
      setResetPasswordUser(null);
      setNewPassword('');
    } catch (err) {
      toast({ title: "שגיאה", description: err.message || "איפוס הסיסמה נכשל", variant: "destructive" });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <CardTitle>ניהול משתמשים</CardTitle>
            <CardDescription>
              הרשאות וניהול המשתמשים במשק. הזמן משתמשים חדשים דרך לינק הרשמה.
            </CardDescription>
          </div>
          <Button onClick={handleOpenInviteDialog} className="flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            הזמן משתמש חדש
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>משתמש</TableHead>
              <TableHead>תפקיד</TableHead>
              <TableHead>מחלקה</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead>פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(user => (
              <TableRow key={user.id}>
                <TableCell>
                  <div>
                    <div className="font-medium">{user.full_name}</div>
                    <div className="text-sm text-gray-500">{user.email}</div>
                  </div>
                </TableCell>
                <TableCell>{getRoleBadge(user.role)}</TableCell>
                <TableCell>{user.department || "-"}</TableCell>
                <TableCell>
                  {user.is_active !== false ? (
                    <Badge variant="outline" className="text-green-600">
                      <UserCheck className="w-3 h-3 ml-1" />
                      פעיל
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-red-600">
                      <UserX className="w-3 h-3 ml-1" />
                      לא פעיל
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {canEditUser(user) ? (
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(user)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        <Shield className="w-3 h-3 ml-1" />
                        מוגן
                      </Badge>
                    )}
                    {currentUser?.is_admin && user.id !== currentUser.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="איפוס סיסמה"
                        onClick={() => { setResetPasswordUser(user); setNewPassword(''); }}
                      >
                        <KeyRound className="w-4 h-4 text-orange-500" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Edit User Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl" dir="rtl">
            <DialogHeader>
              <DialogTitle>עריכת הרשאות משתמש</DialogTitle>
            </DialogHeader>
            {editingUser && (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>תפקיד במערכת</Label>
                    <Select value={formData.role} onValueChange={handleRoleChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {currentUser?.role === "owner" && <SelectItem value="owner">בעלים</SelectItem>}
                        <SelectItem value="manager">מנהל</SelectItem>
                        <SelectItem value="worker">עובד</SelectItem>
                        <SelectItem value="viewer">צופה</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>תפקיד בחברה</Label>
                    <Input value={formData.position} onChange={e => setFormData({...formData, position: e.target.value})} />
                  </div>
                  <div>
                    <Label>מחלקה</Label>
                    <Input value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} />
                  </div>
                  <div>
                    <Label>טלפון</Label>
                    <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={value => setFormData({...formData, is_active: value})}
                  />
                  <Label>משתמש פעיל</Label>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">הרשאות מפורטות</h4>
                  <div className="grid grid-cols-2 gap-4">
                    {Object.entries(permissionLabels).map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between p-3 border rounded-lg">
                        <Label className="text-sm">{label}</Label>
                        <Switch
                          checked={formData.permissions?.[key] || false}
                          onCheckedChange={value => handlePermissionChange(key, value)}
                        />
                      </div>
                    ))}
                  </div>
                  
                  {formData.role === "owner" && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span className="text-sm text-amber-800">בעלים מקבל אוטומטית את כל ההרשאות</span>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    ביטול
                  </Button>
                  <Button type="submit">
                    עדכן הרשאות
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* Reset Password Dialog */}
        <Dialog open={!!resetPasswordUser} onOpenChange={open => !open && setResetPasswordUser(null)}>
          <DialogContent className="max-w-sm" dir="rtl">
            <DialogHeader>
              <DialogTitle>איפוס סיסמה</DialogTitle>
              <DialogDescription>
                איפוס סיסמה עבור: <strong>{resetPasswordUser?.full_name || resetPasswordUser?.email}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label>סיסמה חדשה (לפחות 6 תווים)</Label>
              <Input
                type="password"
                placeholder="סיסמה חדשה"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                minLength={6}
                dir="ltr"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetPasswordUser(null)}>ביטול</Button>
              <Button onClick={handleResetPassword} disabled={isResetting} className="bg-orange-500 hover:bg-orange-600">
                {isResetting ? 'מאפס...' : 'אפס סיסמה'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Invite User Dialog */}
        <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
          <DialogContent className="max-w-lg" dir="rtl">
            <DialogHeader>
              <DialogTitle>הזמנת משתמש חדש</DialogTitle>
              <DialogDescription>
                הזמן משתמש חדש להצטרף למשק "{currentFarm?.name || ''}"
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="invite-name">שם מלא (אופציונלי)</Label>
                <Input
                  id="invite-name"
                  placeholder="שם המשתמש"
                  value={inviteData.full_name}
                  onChange={e => setInviteData({...inviteData, full_name: e.target.value})}
                />
              </div>

              <div>
                <Label htmlFor="invite-email">כתובת אימייל *</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="email@example.com"
                  value={inviteData.email}
                  onChange={e => setInviteData({...inviteData, email: e.target.value})}
                  required
                />
              </div>

              <div>
                <Label htmlFor="invite-role">תפקיד במערכת</Label>
                <Select 
                  value={inviteData.role} 
                  onValueChange={role => setInviteData({...inviteData, role})}
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">צופה - הרשאות צפייה בלבד</SelectItem>
                    <SelectItem value="worker">עובד - הרשאות עבודה בסיסיות</SelectItem>
                    <SelectItem value="manager">מנהל - הרשאות ניהול מלאות</SelectItem>
                    {currentUser?.role === "owner" && (
                      <SelectItem value="owner">בעלים - הרשאות מלאות</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {!inviteLink && (
                <Button onClick={generateInviteLink} className="w-full">
                  צור לינק הזמנה
                </Button>
              )}

              {inviteLink && (
                <div className="space-y-3">
                  <div className="p-3 bg-gray-50 rounded-lg border">
                    <Label className="text-xs text-gray-500 mb-1 block">לינק ההזמנה</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={inviteLink}
                        readOnly
                        className="text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={copyInviteLink}
                      >
                        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={copyInviteLink}
                      className="flex-1"
                    >
                      <Copy className="w-4 h-4 ml-2" />
                      העתק לינק
                    </Button>
                    <Button
                      type="button"
                      onClick={sendInviteEmail}
                      disabled={isSendingInvite}
                      className="flex-1"
                    >
                      {isSendingInvite ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white ml-2" />
                          שולח...
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4 ml-2" />
                          שלח מייל
                        </>
                      )}
                    </Button>
                  </div>

                  <p className="text-xs text-gray-500 text-center">
                    הלינק תקף ל-7 ימים. ניתן להעתיק ולשלוח ידנית או לשלוח דרך מייל.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsInviteDialogOpen(false)}>
                סגור
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}