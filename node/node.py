"""
NoBackdoorMessaging.
"""
from flask import Flask, render_template, request
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
import requests
import os

app = Flask(__name__) # Flask website Class

NODE_HOME = os.environ.get("NODE_HOME", "./default_data")
os.makedirs(os.path.join(NODE_HOME, "keys"), exist_ok=True)
os.makedirs(os.path.join(NODE_HOME, "logs"), exist_ok=True)

PRIVATE_KEY_PATH = os.path.join(NODE_HOME, "keys", "private_key.pem")

@app.route('/')
def main():
    return render_template("setup.html")

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



    if result["login"]:
        return render_template("placeholder.html")
    else:
        return render_template("setup.html")


if __name__ == "__main__":
    app.run(debug=True)
