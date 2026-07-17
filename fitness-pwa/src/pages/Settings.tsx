import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { db, initializeDatabase } from '../database/db';
import type { UserProfile } from '../types';
import { useDarkMode } from '../hooks';
import { DownloadIcon, UploadIcon } from '../components/Icons';

export default function Settings() {
  const { isDark, toggleDarkMode } = useDarkMode();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [exporting, setExporting] = useState(false);

  const { register, handleSubmit } = useForm({
    defaultValues: {
      age: 30,
      height: 161,
      targetWeight: 64,
    },
  });

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      const profile = await db.userProfile.toCollection().first();
      if (profile) {
        setUserProfile(profile);
      }
    } catch (error) {
      console.error('Failed to load user profile:', error);
    }
  };

  const onUpdateProfile = async (data: any) => {
    if (!userProfile) return;

    try {
      await db.userProfile.update(userProfile.id, {
        age: data.age,
        height: data.height,
        targetWeight: data.targetWeight,
        updatedAt: new Date(),
      });

      const updated = await db.userProfile.toCollection().first();
      if (updated) {
        setUserProfile(updated);
      }

      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Failed to update profile:', error);
      alert('Failed to update profile');
    }
  };

  const exportData = async () => {
    try {
      setExporting(true);

      const [userProfiles, exercises, workouts, weights, measurements, fastings, photos, settings] = 
        await Promise.all([
          db.userProfile.toArray(),
          db.exercises.toArray(),
          db.workoutSessions.toArray(),
          db.weightEntries.toArray(),
          db.measurementEntries.toArray(),
          db.fastingSessions.toArray(),
          db.progressPhotos.toArray(),
          db.appSettings.toArray(),
        ]);

      const data = {
        version: 1,
        exportDate: new Date().toISOString(),
        data: {
          userProfiles,
          exercises,
          workouts,
          weights,
          measurements,
          fastings,
          photos,
          settings,
        },
      };

      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fitness-pwa-backup-${new Date().getTime()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      alert('Data exported successfully!');
    } catch (error) {
      console.error('Failed to export data:', error);
      alert('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.version !== 1) {
        alert('Invalid backup format');
        return;
      }

      // Clear existing data
      await db.delete();
      await db.open();
      await initializeDatabase();

      // Import data
      const { userProfiles, exercises, workouts, weights, measurements, fastings, photos, settings } = 
        data.data;

      if (userProfiles?.length) await db.userProfile.bulkAdd(userProfiles);
      if (exercises?.length) await db.exercises.bulkAdd(exercises);
      if (workouts?.length) await db.workoutSessions.bulkAdd(workouts);
      if (weights?.length) await db.weightEntries.bulkAdd(weights);
      if (measurements?.length) await db.measurementEntries.bulkAdd(measurements);
      if (fastings?.length) await db.fastingSessions.bulkAdd(fastings);
      if (photos?.length) await db.progressPhotos.bulkAdd(photos);
      if (settings?.length) await db.appSettings.bulkAdd(settings);

      alert('Data imported successfully! Refreshing...');
      window.location.reload();
    } catch (error) {
      console.error('Failed to import data:', error);
      alert('Failed to import data');
    }
  };

  const resetAllData = async () => {
    if (!confirm('Are you sure? This will delete ALL your data. This cannot be undone.')) {
      return;
    }

    try {
      await db.delete();
      await db.open();
      await initializeDatabase();
      alert('All data has been reset. Refreshing...');
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset data:', error);
      alert('Failed to reset data');
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-2">
            Settings
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Customize your app preferences
          </p>
        </div>

        {/* User Profile */}
        <div className="card-lg mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
            Profile
          </h2>

          {userProfile && (
            <form onSubmit={handleSubmit(onUpdateProfile)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Age
                  </label>
                  <input
                    type="number"
                    {...register('age', { min: 1, max: 150 })}
                    className="input-field"
                    defaultValue={userProfile.age}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Height (cm)
                  </label>
                  <input
                    type="number"
                    {...register('height', { min: 50, max: 300 })}
                    className="input-field"
                    defaultValue={userProfile.height}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Target Weight (kg)
                  </label>
                  <input
                    type="number"
                    {...register('targetWeight', { min: 20, max: 300 })}
                    className="input-field"
                    step="0.1"
                    defaultValue={userProfile.targetWeight}
                  />
                </div>
              </div>

              <button type="submit" className="btn-primary w-full">
                Update Profile
              </button>
            </form>
          )}
        </div>

        {/* Appearance */}
        <div className="card-lg mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
            Appearance
          </h2>

          <button
            onClick={toggleDarkMode}
            className="w-full flex items-center justify-between p-4 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <span className="font-semibold text-slate-900 dark:text-white">
              Dark Mode
            </span>
            <div className={`w-12 h-6 rounded-full transition-colors ${
              isDark ? 'bg-blue-600' : 'bg-slate-300'
            }`}>
              <div className={`w-5 h-5 rounded-full bg-white mt-0.5 transition-transform ${
                isDark ? 'ml-6' : 'ml-1'
              }`}></div>
            </div>
          </button>
        </div>

        {/* Data Management */}
        <div className="card-lg mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
            Data Management
          </h2>

          <div className="space-y-3">
            <button
              onClick={exportData}
              disabled={exporting}
              className="w-full flex items-center justify-center gap-2 btn-primary"
            >
              <DownloadIcon className="w-5 h-5" />
              {exporting ? 'Exporting...' : 'Export Data'}
            </button>

            <div className="relative">
              <input
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 btn-secondary"
              >
                <UploadIcon className="w-5 h-5" />
                Import Data
              </button>
            </div>

            <button
              onClick={resetAllData}
              className="w-full px-4 py-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 font-semibold transition-colors"
            >
              Reset All Data
            </button>
          </div>
        </div>

        {/* About */}
        <div className="card-lg">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
            About
          </h2>

          <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
            <div>
              <p className="font-semibold text-slate-900 dark:text-white mb-1">
                FitnessPWA
              </p>
              <p>Your personal fitness coach, workout tracker, and transformation companion.</p>
            </div>

            <div>
              <p className="font-semibold text-slate-900 dark:text-white mb-1">
                Version
              </p>
              <p>1.0.0</p>
            </div>

            <div>
              <p className="font-semibold text-slate-900 dark:text-white mb-1">
                Features
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>Offline support</li>
                <li>Workout tracking</li>
                <li>Weight monitoring</li>
                <li>Fasting tracker</li>
                <li>Progress analytics</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
