import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { User, Lock, Mail, MapPin, Code, Award, Save, CheckCircle2, Camera } from 'lucide-react';
import { RoleBadge } from '../common/Badge';

export const Profile = () => {
  const { currentUser, updateUser, logAudit, uploadAvatar } = useApp();

  const [formData, setFormData] = useState({
    name: currentUser.name || '',
    department: currentUser.department || '',
    title: currentUser.title || '',
    phone: currentUser.phone || '',
    address: currentUser.address || '',
    stack: currentUser.stack || '',
    skills: currentUser.skills || '',
    avatar: currentUser.avatar || ''
  });

  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handlePasswordChange = (e) => {
    setPasswords({ ...passwords, [e.target.name]: e.target.value });
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file.');
      return;
    }

    try {
      setIsUploading(true);
      setError('');
      const uploadedUrl = await uploadAvatar(file);
      setFormData(prev => ({ ...prev, avatar: uploadedUrl }));
      setSuccessMessage('Avatar uploaded successfully!');
    } catch (err) {
      setError('Failed to upload avatar image.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (passwords.newPassword || passwords.currentPassword || passwords.confirmPassword) {
      if (passwords.newPassword !== passwords.confirmPassword) {
        setError('New passwords do not match.');
        return;
      }
      if (!passwords.currentPassword) {
        setError('Please enter your current password to update it.');
        return;
      }
    }

    setIsSaving(true);
    // Previously fired-and-forgot — updateUser was never awaited, so
    // "Profile updated successfully!" showed unconditionally, regardless
    // of whether the save actually worked. Combined with updateUser now
    // correctly rejecting failures instead of silently faking success,
    // that message was flatly wrong whenever a save failed — which is
    // exactly why fields looked saved but vanished on reload.
    const result = await updateUser(currentUser.id, {
      ...formData,
      ...(passwords.newPassword
        ? { password: passwords.newPassword, currentPassword: passwords.currentPassword }
        : {})
    });
    setIsSaving(false);

    if (!result) {
      // updateUser already alerted with the real error (e.g. "Current
      // password is incorrect") — don't also claim success here.
      return;
    }

    logAudit({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action: 'USER_PROFILE_UPDATED',
      entityType: 'user',
      entityId: currentUser.id,
      entityTitle: currentUser.name,
      details: 'Updated personal profile details, stack, or password.'
    });

    setSuccessMessage('Profile updated successfully!');
    setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-slate-300 dark:border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-zinc-100">Account Profile</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">Manage your personal credentials, tech stack, and security settings.</p>
        </div>
        <RoleBadge role={currentUser.role} size="md" />
      </div>

      {successMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {successMessage}
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info & Avatar Card */}
        <div className="bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 rounded-xl p-6 shadow-2xs space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <User className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Personal Information
          </h2>

          <div className="flex items-center gap-4 py-2">
            <div className="relative group">
              <img src={formData.avatar || 'https://via.placeholder.com/150'} alt={formData.name} className="w-16 h-16 rounded-full object-cover ring-2 ring-indigo-500/30" />
              <label className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer">
                <Camera className="w-5 h-5 text-white" />
                <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" disabled={isUploading} />
              </label>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Profile Photo Upload</label>
              <label className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg cursor-pointer inline-flex items-center gap-2 shadow-sm transition">
                <Camera className="w-3.5 h-3.5" />
                {isUploading ? 'Uploading...' : 'Choose Image File'}
                <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" disabled={isUploading} />
              </label>
              <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-1">Supports PNG, JPG, or WebP up to 5MB.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Full Name</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-800/80 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Email Address (Read-Only)</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 dark:text-zinc-500">
                  <Mail className="w-4 h-4" />
                </span>
                <input
                  type="email"
                  disabled
                  value={currentUser.email}
                  className="w-full pl-9 pr-3 py-2 bg-slate-300/40 dark:bg-zinc-950/60 border border-slate-300 dark:border-zinc-800 rounded-lg text-xs text-slate-500 dark:text-zinc-500 cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Job Title</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-800/80 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Phone Number</label>
              <input
                type="text"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-800/80 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Address</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 dark:text-zinc-400">
                  <MapPin className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  placeholder="Enter your residential or office address"
                  className="w-full pl-9 pr-3 py-2 bg-slate-100 dark:bg-zinc-800/80 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Technical Stack & Skills Card */}
        <div className="bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 rounded-xl p-6 shadow-2xs space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Code className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Tech Stack & Skills
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Tech Stack (e.g. React, Go, PostgreSQL)</label>
              <input
                type="text"
                name="stack"
                value={formData.stack}
                onChange={handleChange}
                placeholder="React, Node.js, Go, Docker"
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-800/80 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Skills & Specializations</label>
              <input
                type="text"
                name="skills"
                value={formData.skills}
                onChange={handleChange}
                placeholder="Backend Architecture, REST APIs, UI Design"
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-800/80 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Password Security Card */}
        <div className="bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 rounded-xl p-6 shadow-2xs space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" /> Security & Password
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Current Password</label>
              <input
                type="password"
                name="currentPassword"
                value={passwords.currentPassword}
                onChange={handlePasswordChange}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-800/80 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">New Password</label>
              <input
                type="password"
                name="newPassword"
                value={passwords.newPassword}
                onChange={handlePasswordChange}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-800/80 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Re-enter New Password</label>
              <input
                type="password"
                name="confirmPassword"
                value={passwords.confirmPassword}
                onChange={handlePasswordChange}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-800/80 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-xs transition shadow-md cursor-pointer"
          >
            <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </div>
      </form>
    </div>
  );
};