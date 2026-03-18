import { Box, Text } from 'ink';

const TEXT = `     _.ΦΦ8$8ΦΦ..    
   .ΦΘΦƒⁿ"ΦΦΦΘ#ΦΦ.  
 /#8ΦΦ/ x  #Φ8ΦæΦΦ\\ 
+ΦΦΦ+/ @A@ +ΦΦ8ΦΦ#Φ:
+Φ(    ___       )Φ|
\\ΦΦΦΓ áΦΦΦì  ΦΦ/Φ#Θ;
 ΦæΦææ#ΦΘΦΦ+ +/ +ΦΦ 
  \`Φ8ΦΦ8ΦΦ#Φ\\_.ΦΦΦ  
    \`-ΦΦΦµµΦΦΦ'''    `;

export const AmplitudeLogo = ({ color = 'white' }: { color?: string }) => (
  <Box marginBottom={1}>
    <Text color={color}>{TEXT}</Text>
  </Box>
);
