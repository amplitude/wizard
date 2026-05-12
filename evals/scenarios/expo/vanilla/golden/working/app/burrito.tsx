import { StyleSheet, Text, View, Pressable } from 'react-native';
import { track } from '@amplitude/analytics-react-native';

export default function Burrito() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Burrito</Text>
      <Pressable
        style={styles.button}
        onPress={() =>
          track('Burrito Considered', { 'page name': 'burrito' })
        }
      >
        <Text style={styles.buttonText}>Consider</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 16 },
  button: { padding: 12, backgroundColor: '#a64', borderRadius: 6 },
  buttonText: { color: '#fff' },
});
