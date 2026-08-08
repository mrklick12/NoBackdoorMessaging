"""
NoBackdoorMessaging.
"""
from flask import Flask, render_template, request

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes, serialization

import requests
import os
import json
import base64

app = Flask(__name__) # Flask website Class

NODE_HOME = os.environ.get("NODE_HOME", "./default_data")
os.makedirs(os.path.join(NODE_HOME, "keys"), exist_ok=True)
os.makedirs(os.path.join(NODE_HOME, "logs"), exist_ok=True)

PRIVATE_KEY_PATH = os.path.join(NODE_HOME, "keys", "private_key.pem")

def get_my_username():
    with open(os.path.join(NODE_HOME, "config.json")) as f:
        return json.load(f)["username"]


def decrypt_messages(messages):
    with open(PRIVATE_KEY_PATH, "rb") as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None) 
    clean_messages = []
    for message in messages:
        encrypted_aes_key = base64.b64decode(message["encrypted_aes_key"])
        nonce = base64.b64decode(message["nonce"])
        ciphertext = base64.b64decode(message["ciphertext"])

        decrypted_aes_key = private_key.decrypt(
            encrypted_aes_key,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None))

        aesgcm = AESGCM(decrypted_aes_key)
        plaintext_bytes = aesgcm.decrypt(nonce, ciphertext, None)
        plaintext = plaintext_bytes.decode("utf-8")

        clean_messages.append((message["from"], plaintext))

    return clean_messages

        

        

@app.route('/')
def main():
    return render_template("index.html")

@app.route("/register")
def registerForm():
    return render_template("setup.html")

@app.route("/login")
def loginForm():
    return render_template("login.html")

@app.route("/register", methods=["POST"])
def register():
    username = request.form["username"]

    # generate RSA key pair
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048)
    public_key = private_key.public_key()

    # turn public key object into plain text
    pem_bytes = public_key.public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo)

    pem_string = pem_bytes.decode("utf-8") # turns bytes into string


    response = requests.post("http://localhost:6000/register", 
                  data={"username": username, "public_key": pem_string})
    result = response.json()

    with open(PRIVATE_KEY_PATH, "wb") as f: # SAVES PRIVATE KEY LOCALLY
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()))

    with open(os.path.join(NODE_HOME, "config.json"), "w") as f:
        json.dump({"username": username}, f)



    if result["login"]:
        return render_template("chat.html", username=username)
    else:
        return render_template("setup.html")

@app.route("/login", methods=["POST"])
def login():
    username = request.form["username"]

    response = requests.post("http://localhost:6000/login", 
                      data={"username": username})
    result = response.json()

    if result["userExists"]:
        return render_template("chat.html", username=username)
    else:
        return render_template("login.html", error=f"No user registered called {username} ")
    

@app.route("/send", methods=["POST"])
def send():
    toUser = request.form["to"]
    plaintext = request.form["message"].encode("utf-8")

    pubkey_response = requests.get(f"http://localhost:6000/pubkey/{toUser}")
    result = pubkey_response.json()

    if result["public_key"] == None:
        return render_template("chat.html", error=f"No user registered {toUser}")

    toUserPubKey = serialization.load_pem_public_key(result["public_key"].encode("utf-8"))
    
    # generate a random 256-bit AES key
    aes_key = AESGCM.generate_key(bit_length=256)

    # wrap it in an AESGCM object
    aesgcm = AESGCM(aes_key)

    # NONCE = NUMBER USED ONCE (standard term)
    nonce = os.urandom(12)   # 12 bytes is the standard size for GCM

    ciphertext = aesgcm.encrypt(nonce, plaintext, None)

    encrypted_aes_key = toUserPubKey.encrypt(
        aes_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None))
    

    ciphertext_b64 = base64.b64encode(ciphertext).decode("utf-8")
    encrypted_aes_key_b64 = base64.b64encode(encrypted_aes_key).decode("utf-8")
    nonce_b64 = base64.b64encode(nonce).decode("utf-8")

    response = requests.post(f"http://localhost:6000/dropoff/{toUser}",
                          data={"from": get_my_username(),
                                "ciphertext": ciphertext_b64,
                                "encrypted_aes_key": encrypted_aes_key_b64,
                                "nonce": nonce_b64})
    result = response.json()

    if result["ok"]:
        return render_template("chat.html", username=get_my_username())
    else:
        return render_template("chat.html", error="an error occured")


@app.route("/collect", methods=["GET", "POST"])
def collect():
    username = get_my_username()
    response = requests.post(f"http://localhost:6000/collect/{username}")
    messages = response.json()["messages"]

    clean_messages = decrypt_messages(messages)

    return render_template("chat.html", username=username, messages=clean_messages)



if __name__ == "__main__":
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))
