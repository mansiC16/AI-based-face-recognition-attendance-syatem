print("=" * 50)
print("Testing InsightFace Setup")
print("=" * 50)

try:
    print("\n1. Importing insightface...")
    import insightface
    print("   ✅ InsightFace imported successfully")
    print(f"   Version: {insightface.__version__}")
except ImportError as e:
    print(f"   ❌ Failed to import InsightFace: {e}")
    print("   Fix: pip install insightface")
    exit(1)

try:
    print("\n2. Initializing FaceAnalysis...")
    from insightface.app import FaceAnalysis
    
    print("   Creating FaceAnalysis object (this may download ~150MB of models)...")
    face_app = FaceAnalysis(
        name="buffalo_l",
        providers=["CPUExecutionProvider"]
    )
    print("   ✅ FaceAnalysis object created")
except Exception as e:
    print(f"   ❌ Failed to create FaceAnalysis: {e}")
    print("\n   Possible fixes:")
    print("   1. Check internet connection (models need to download)")
    print("   2. Try: pip install onnxruntime --upgrade")
    print("   3. Delete ~/.insightface/models/ and try again")
    exit(1)

try:
    print("\n3. Preparing model (loading weights)...")
    face_app.prepare(ctx_id=-1)  # -1 = CPU
    print("   ✅ Model prepared successfully!")
except Exception as e:
    print(f"   ❌ Failed to prepare model: {e}")
    print("\n   This usually means:")
    print("   1. ONNX Runtime is not properly installed")
    print("   2. Model files are corrupted")
    print("\n   Fix:")
    print("   pip uninstall onnxruntime")
    print("   pip install onnxruntime")
    exit(1)

print("\n" + "=" * 50)
print("✅ ALL TESTS PASSED!")
print("=" * 50)
print("\nYour face recognition setup is working correctly.")
print("You can now start the FastAPI server.")