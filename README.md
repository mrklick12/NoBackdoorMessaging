# NoBackdoorMessaging
A self-hosted, end-to-end encrypted messenger where even the relay server that routes messages between users is cryptographically incapable of reading them, so there's no central company for a government to legally pressure into building a backdoor.

How to run your node in terminal from root directory:

$env:NODE_HOME="./alice_data"
$env:PORT="5000"
python node/node.py
