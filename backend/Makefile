GAME_ANATOMY_DIR ?= $(abspath $(CURDIR)/../game-anatomy)
PYTHON_BINDING_DIR := $(GAME_ANATOMY_DIR)/bindings/python
OUT_DIR ?= $(CURDIR)/out

.PHONY: all clean
all:
	$(MAKE) -C $(PYTHON_BINDING_DIR) OUT_DIR=$(OUT_DIR)

clean:
	rm -rf $(OUT_DIR)