import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { db } from '../database/db';
import type { WeightEntry, UserProfile } from '../types';
import { formatDate, calculateBMI, getBMICategory } from '../utils/helpers';
import { TrashIcon } from '../components/Icons';

export default function Weight() {
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [currentBMI, setCurrentBMI] = useState<number | null>(null);

  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      weight: 0,
      notes: '',
    },
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load user profile
      const profile = await db.userProfile.toCollection().first();
      if (profile) {
        setUserProfile(profile);
      }

      // Load weight entries
      const entries = await db.weightEntries
        .orderBy('date')
        .reverse()
        .toArray();
      setWeightEntries(entries);

      // Calculate current BMI
      if (entries.length > 0 && profile) {
        const currentWeight = entries[0].weight;
        const bmi = calculateBMI(currentWeight, profile.height);
        setCurrentBMI(bmi);
      }
    } catch (error) {
      console.error('Failed to load weight data:', error);
    }
  };

  const onSubmit = async (data: any) => {
    try {
      const newEntry: WeightEntry = {
        id: `weight-${Date.now()}`,
        date: new Date(),
        weight: data.weight,
        notes: data.notes,
      };

      await db.weightEntries.add(newEntry);
      setWeightEntries([newEntry, ...weightEntries]);

      // Update user profile with new current weight
      if (userProfile) {
        await db.userProfile.update(userProfile.id, {
          currentWeight: data.weight,
          updatedAt: new Date(),
        });
      }

      reset();
    } catch (error) {
      console.error('Failed to add weight entry:', error);
      alert('Failed to add weight entry');
    }
  };

  const deleteEntry = async (id: string) => {
    try {
      await db.weightEntries.delete(id);
      setWeightEntries(weightEntries.filter(e => e.id !== id));
    } catch (error) {
      console.error('Failed to delete weight entry:', error);
    }
  };

  const currentWeight = weightEntries.length > 0 ? weightEntries[0].weight : null;
  const weeklyAverage = weightEntries.length > 0 
    ? weightEntries.slice(0, 7).reduce((sum, e) => sum + e.weight, 0) / Math.min(7, weightEntries.length)
    : null;
  const monthlyAverage = weightEntries.length > 0
    ? weightEntries.slice(0, 30).reduce((sum, e) => sum + e.weight, 0) / Math.min(30, weightEntries.length)
    : null;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-2">
            Weight Tracker
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Track your weight and progress
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="card-lg">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">Current Weight</h3>
            <p className="text-3xl font-bold text-slate-900 dark:text-white">
              {currentWeight ? currentWeight.toFixed(1) : '--'} kg
            </p>
          </div>

          <div className="card-lg">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">Weekly Avg</h3>
            <p className="text-3xl font-bold text-slate-900 dark:text-white">
              {weeklyAverage ? weeklyAverage.toFixed(1) : '--'} kg
            </p>
          </div>

          <div className="card-lg">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">Monthly Avg</h3>
            <p className="text-3xl font-bold text-slate-900 dark:text-white">
              {monthlyAverage ? monthlyAverage.toFixed(1) : '--'} kg
            </p>
          </div>

          <div className="card-lg">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">BMI</h3>
            <p className="text-3xl font-bold text-slate-900 dark:text-white">
              {currentBMI ? currentBMI.toFixed(1) : '--'}
            </p>
            {currentBMI && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {getBMICategory(currentBMI)}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Add Weight Entry */}
          <div className="lg:col-span-1">
            <div className="card-lg">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                Log Weight
              </h2>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Weight (kg)
                  </label>
                  <input
                    type="number"
                    {...register('weight', { required: true, min: 0 })}
                    step="0.1"
                    className="input-field"
                    placeholder="75.5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Notes (optional)
                  </label>
                  <textarea
                    {...register('notes')}
                    className="input-field"
                    rows={3}
                    placeholder="How are you feeling?"
                  ></textarea>
                </div>

                <button type="submit" className="btn-primary w-full">
                  Log Weight
                </button>
              </form>
            </div>
          </div>

          {/* Weight History */}
          <div className="lg:col-span-2">
            <div className="card-lg">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                History
              </h2>

              {weightEntries.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-slate-600 dark:text-slate-400">
                    No weight entries yet. Log your first weight!
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {weightEntries.map((entry, idx) => {
                    const changeNum = idx < weightEntries.length - 1 
                      ? entry.weight - weightEntries[idx + 1].weight
                      : null;

                    return (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {entry.weight.toFixed(1)} kg
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {formatDate(new Date(entry.date))}
                            {changeNum !== null && (
                              <span className={changeNum > 0 ? 'text-red-500' : 'text-green-500'}>
                                {' '}• {changeNum > 0 ? '+' : ''}{changeNum.toFixed(1)} kg
                              </span>
                            )}
                          </p>
                          {entry.notes && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                              {entry.notes}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          className="p-2 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        >
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
