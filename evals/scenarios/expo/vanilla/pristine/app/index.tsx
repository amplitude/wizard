import { Link } from 'expo-router';
import { StyleSheet, Text, View, Pressable } from 'react-native';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome</Text>
      <Pressable style={styles.button}>
        <Text style={styles.buttonText}>Sign up</Text>
      </Pressable>
      <Link href="/burrito" style={styles.link}>
        Try a burrito
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 16 },
  button: { padding: 12, backgroundColor: '#444', borderRadius: 6 },
  buttonText: { color: '#fff' },
  link: { marginTop: 16, color: '#06f' },
});
