import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { Picker } from '@react-native-picker/picker';
import uuid from 'react-native-uuid';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

const SYNDROME_CODES = [
  { label: 'Select syndrome code...', value: '' },
  { label: 'ILI — Influenza-Like Illness', value: 'ILI' },
  { label: 'ARI — Acute Respiratory Infection', value: 'ARI' },
  { label: 'GI — Gastrointestinal', value: 'GI' },
  { label: 'FUO — Fever of Unknown Origin', value: 'FUO' },
  { label: 'NES — Neurological Syndrome', value: 'NES' },
  { label: 'HEM — Haemorrhagic Fever', value: 'HEM' },
  { label: 'DER — Dermatological', value: 'DER' },
];

/**
 * ReportScreen
 *
 * Collects a disease surveillance event report and packages it into:
 * { eventId, sourceId, timestamp, syndromeCode, location, reporterId, notes }
 *
 * eventId  — UUID generated on submit (not editable by the user)
 * timestamp — ISO-8601 string captured at submit time
 */
export default function ReportScreen() {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      sourceId: '',
      syndromeCode: '',
      location: '',
      reporterId: '',
      notes: '',
    },
  });

  const { submitReport, isFlushing } = useOfflineQueue();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const busy = isSubmitting || isFlushing;

  const onSubmit = async (data) => {
    setIsSubmitting(true);
    try {
      const payload = {
        eventId: uuid.v4(),
        sourceId: data.sourceId.trim(),
        timestamp: new Date().toISOString(),
        syndromeCode: data.syndromeCode,
        location: data.location.trim(),
        reporterId: data.reporterId.trim(),
        notes: data.notes.trim(),
      };

      const status = await submitReport(payload);
      const sent = status === 'sent';

      Alert.alert(
        sent ? 'Report Sent' : 'Report Queued',
        sent
          ? `Event ID: ${payload.eventId}\nSent to gateway successfully.`
          : `Event ID: ${payload.eventId}\nSaved offline. Will be sent when connectivity is restored.`,
        [{ text: 'OK', onPress: () => reset() }],
      );
    } catch (err) {
      Alert.alert('Submission Error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>New Disease Event Report</Text>

      {/* sourceId */}
      <Text style={styles.label}>Source ID *</Text>
      <Controller
        control={control}
        name="sourceId"
        rules={{ required: 'Source ID is required' }}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            style={[styles.input, errors.sourceId && styles.inputError]}
            placeholder="e.g. HOSP-001"
            autoCapitalize="characters"
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
          />
        )}
      />
      {errors.sourceId && (
        <Text style={styles.errorText}>{errors.sourceId.message}</Text>
      )}

      {/* syndromeCode */}
      <Text style={styles.label}>Syndrome Code *</Text>
      <Controller
        control={control}
        name="syndromeCode"
        rules={{ required: 'Syndrome code is required' }}
        render={({ field: { onChange, value } }) => (
          <View
            style={[
              styles.pickerWrapper,
              errors.syndromeCode && styles.inputError,
            ]}
          >
            <Picker
              selectedValue={value}
              onValueChange={onChange}
              style={styles.picker}
              prompt="Select syndrome code"
            >
              {SYNDROME_CODES.map((item) => (
                <Picker.Item
                  key={item.value}
                  label={item.label}
                  value={item.value}
                />
              ))}
            </Picker>
          </View>
        )}
      />
      {errors.syndromeCode && (
        <Text style={styles.errorText}>{errors.syndromeCode.message}</Text>
      )}

      {/* location */}
      <Text style={styles.label}>Location *</Text>
      <Controller
        control={control}
        name="location"
        rules={{ required: 'Location is required' }}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            style={[styles.input, errors.location && styles.inputError]}
            placeholder="e.g. Addis Ababa, Bole Sub-city"
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
          />
        )}
      />
      {errors.location && (
        <Text style={styles.errorText}>{errors.location.message}</Text>
      )}

      {/* reporterId */}
      <Text style={styles.label}>Reporter ID *</Text>
      <Controller
        control={control}
        name="reporterId"
        rules={{ required: 'Reporter ID is required' }}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            style={[styles.input, errors.reporterId && styles.inputError]}
            placeholder="e.g. USER-042"
            autoCapitalize="characters"
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
          />
        )}
      />
      {errors.reporterId && (
        <Text style={styles.errorText}>{errors.reporterId.message}</Text>
      )}

      {/* notes */}
      <Text style={styles.label}>Notes</Text>
      <Controller
        control={control}
        name="notes"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Additional clinical or epidemiological observations…"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
          />
        )}
      />

      {/* auto-populated read-only info */}
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          Event ID and timestamp are generated automatically on submission.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.submitButton, busy && styles.submitButtonDisabled]}
        onPress={handleSubmit(onSubmit)}
        activeOpacity={0.8}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.submitButtonText}>Submit Report</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6F9',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A2B4A',
    marginBottom: 24,
    marginTop: Platform.OS === 'ios' ? 50 : 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  textArea: {
    minHeight: 100,
    paddingTop: 10,
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 4,
  },
  pickerWrapper: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
    color: '#111827',
  },
  infoBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 12,
    marginTop: 18,
    borderLeftWidth: 4,
    borderLeftColor: '#3B82F6',
  },
  infoText: {
    fontSize: 13,
    color: '#1D4ED8',
  },
  submitButton: {
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 28,
  },
  submitButtonDisabled: {
    backgroundColor: '#93C5FD',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
